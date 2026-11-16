import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(
	new URL("./lint-slop-changed.ts", import.meta.url),
);
const baseline = {
	"no-arbitrary-tailwind-values": 0,
	"no-direct-implementation-imports": 0,
	"no-inline-visual-styles": 0,
	"no-raw-color": 0,
	"no-raw-spacing": 0,
	"no-raw-typography": 0,
};

const diagnostic = {
	code: "design-system(no-raw-color)",
	filename: "example.ts",
	message: "Use a semantic color.",
	labels: [{ span: { line: 2, column: 4 } }],
};

for (const fixture of [
	{
		name: "reports a JSON diagnostic on an added line",
		diagnostics: [diagnostic],
		toolExit: 1,
		exit: 1,
		message:
			"example.ts:2:4: design-system(no-raw-color): Use a semantic color.",
	},
	{
		name: "ignores a valid diagnostic on an unchanged line",
		diagnostics: [
			{ ...diagnostic, labels: [{ span: { line: 1, column: 4 } }] },
		],
		toolExit: 1,
		exit: 0,
		message: "clean on added lines",
	},
	{
		name: "rejects malformed diagnostics",
		diagnostics: [{ ...diagnostic, labels: [] }],
		toolExit: 1,
		exit: 1,
		message: "did not return valid JSON diagnostics",
	},
	{
		name: "rejects a tool failure with an empty envelope",
		diagnostics: [],
		toolExit: 1,
		exit: 1,
		message: "did not return valid JSON diagnostics",
	},
]) {
	test(fixture.name, async () => {
		const root = await mkdtemp(join(tmpdir(), "tripwire-lint-changed-"));
		try {
			await mkdir(join(root, "node_modules", ".bin"), { recursive: true });
			await mkdir(join(root, ".design-system"));
			const executable = join(root, "node_modules", ".bin", "oxlint");
			await writeFile(
				executable,
				`#!/bin/sh
if [ "$1" = apps/web/src ]; then
	exec /bin/echo '{"diagnostics":[]}'
fi
[ "$1" = --format ] && [ "$2" = json ] || exit 2
/bin/cat oxlint-output.json
exit ${fixture.toolExit}
`,
			);
			await chmod(executable, 0o755);
			await writeFile(
				join(root, "oxlint-output.json"),
				JSON.stringify({ diagnostics: fixture.diagnostics }),
			);
			await writeFile(
				join(root, ".design-system", "design-system-lint-baseline.json"),
				JSON.stringify(baseline),
			);
			await writeFile(join(root, "example.ts"), "export const before = 1;\n");
			expect(Bun.spawnSync(["git", "init", "-q"], { cwd: root }).exitCode).toBe(
				0,
			);
			expect(
				Bun.spawnSync(["git", "add", "example.ts"], { cwd: root }).exitCode,
			).toBe(0);
			expect(
				Bun.spawnSync(
					[
						"git",
						"-c",
						"user.name=Tripwire Test",
						"-c",
						"user.email=test@example.com",
						"commit",
						"-qm",
						"Baseline fixture",
					],
					{ cwd: root },
				).exitCode,
			).toBe(0);
			await writeFile(
				join(root, "example.ts"),
				"export const before = 1;\nexport const after = 2;\n",
			);
			const child = Bun.spawn([process.execPath, "run", script, "HEAD"], {
				cwd: root,
				stdout: "pipe",
				stderr: "pipe",
			});
			const [exit, stdout, stderr] = await Promise.all([
				child.exited,
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
			]);
			expect(exit).toBe(fixture.exit);
			expect(stdout + stderr).toContain(fixture.message);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
}
