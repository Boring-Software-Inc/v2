import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./check-boundaries.ts", import.meta.url));

for (const fixture of [
	{
		name: "allowed contract import",
		owner: "web",
		target: "contracts",
		exit: 0,
	},
	{ name: "forbidden core import", owner: "web", target: "core", exit: 1 },
	{
		name: "unknown package import",
		owner: "worker",
		target: "unknown",
		exit: 1,
	},
	{ name: "self import", owner: "worker", target: "worker", exit: 0 },
	{
		name: "unknown owner is ignored",
		owner: "constructor",
		target: "core",
		exit: 0,
	},
]) {
	test(`dependency boundaries: ${fixture.name}`, async () => {
		const root = await mkdtemp(join(tmpdir(), "tripwire-boundaries-"));
		try {
			const source = join(root, "apps", fixture.owner, "src");
			await mkdir(source, { recursive: true });
			await writeFile(
				join(source, "fixture.ts"),
				`import "@tripwire/${fixture.target}";\n`,
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
			expect(stdout + stderr).toContain(
				fixture.exit === 0 ? "boundary check passed" : "boundary check failed",
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
}
