import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(
	new URL("./check-design-system-lint-baseline.ts", import.meta.url),
);
const baseline = {
	"no-arbitrary-tailwind-values": 0,
	"no-direct-implementation-imports": 0,
	"no-inline-visual-styles": 0,
	"no-raw-color": 0,
	"no-raw-spacing": 0,
	"no-raw-typography": 0,
};

for (const fixture of [
	{
		name: "exact counts",
		baseline,
		output: { diagnostics: [] },
		exit: 0,
		message: "baseline holds",
	},
	{
		name: "null baseline",
		baseline: null,
		output: { diagnostics: [] },
		exit: 1,
		message: "must contain an object",
	},
	{
		name: "array baseline",
		baseline: [],
		output: { diagnostics: [] },
		exit: 1,
		message: "must contain an object",
	},
	{
		name: "unknown rule",
		baseline: { ...baseline, surprise: 0 },
		output: { diagnostics: [] },
		exit: 1,
		message: "contains unknown rules: surprise",
	},
	{
		name: "missing count",
		baseline: {},
		output: { diagnostics: [] },
		exit: 1,
		message: "non-negative integer for no-arbitrary-tailwind-values",
	},
	{
		name: "negative count",
		baseline: { ...baseline, "no-raw-color": -1 },
		output: { diagnostics: [] },
		exit: 1,
		message: "non-negative integer for no-raw-color",
	},
	{
		name: "fraction count",
		baseline: { ...baseline, "no-raw-color": 0.5 },
		output: { diagnostics: [] },
		exit: 1,
		message: "non-negative integer for no-raw-color",
	},
	{
		name: "string count",
		baseline: { ...baseline, "no-raw-color": "0" },
		output: { diagnostics: [] },
		exit: 1,
		message: "non-negative integer for no-raw-color",
	},
	{
		name: "regression",
		baseline,
		output: { diagnostics: [{ code: "design-system(no-raw-color)" }] },
		exit: 1,
		message: "1 exceeds baseline 0",
	},
	{
		name: "stale baseline",
		baseline: { ...baseline, "no-raw-color": 1 },
		output: { diagnostics: [] },
		exit: 1,
		message: "0 is below baseline 1",
	},
	{
		name: "malformed tool envelope",
		baseline,
		output: {},
		exit: 1,
		message: "diagnostics array",
	},
	{
		name: "malformed diagnostic",
		baseline,
		output: { diagnostics: [{}] },
		exit: 1,
		message: "diagnostics array",
	},
]) {
	test(`visual lint baseline: ${fixture.name}`, async () => {
		const root = await mkdtemp(join(tmpdir(), "tripwire-baseline-"));
		try {
			await mkdir(join(root, "node_modules", ".bin"), { recursive: true });
			await mkdir(join(root, ".design-system"));
			const executable = join(root, "node_modules", ".bin", "oxlint");
			await writeFile(
				executable,
				"#!/bin/sh\nexec /bin/cat oxlint-output.json\n",
			);
			await chmod(executable, 0o755);
			await writeFile(
				join(root, "oxlint-output.json"),
				JSON.stringify(fixture.output),
			);
			await writeFile(
				join(root, ".design-system", "design-system-lint-baseline.json"),
				JSON.stringify(fixture.baseline),
			);
			const child = Bun.spawn([process.execPath, "run", script], {
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
