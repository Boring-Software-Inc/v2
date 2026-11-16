import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(
	new URL("./check-ui-boundaries.ts", import.meta.url),
);

interface Fixture {
	name: string;
	file: string;
	source: string;
	exit: number;
	message?: string;
	manifest?: {
		dependencies: Record<string, string | number>;
	};
}

const fixtures: Fixture[] = [
	{
		name: "ui-sdk stays inside packages/ui",
		file: "packages/ui/src/button.tsx",
		source: 'export { Button } from "@ui-sdk/react/button";',
		exit: 0,
	},
	{
		name: "application cannot import ui-sdk",
		file: "apps/web/src/button.tsx",
		source: 'import { Button } from "@ui-sdk/react/button";',
		exit: 1,
	},
	{
		name: "dynamic ui-sdk import is rejected",
		file: "apps/web/src/button.tsx",
		source: 'const button = import("@ui-sdk/react/button");',
		exit: 1,
	},
	{
		name: "strict mode rejects Base UI",
		file: "packages/ui/src/button.tsx",
		source: 'import { Button } from "@base-ui/react/button";',
		exit: 1,
	},
	{
		name: "strict mode rejects legacy Glaze",
		file: "apps/web/src/button.tsx",
		source: 'export { Button } from "#/design-system/ui/button";',
		exit: 1,
	},
	{
		name: "route modules delegate visual primitives to the page",
		file: "apps/web/src/routes/queue.tsx",
		source: 'import { Status } from "@tripwire/ui/status";',
		exit: 1,
	},
	{
		name: "root may wire the UI provider",
		file: "apps/web/src/routes/__root.tsx",
		source: 'import { TooltipProvider } from "@tripwire/ui/tooltip";',
		exit: 0,
	},
	{
		name: "invalid package dependencies fail instead of bypassing the boundary",
		file: "apps/web/src/index.ts",
		source: "export {};",
		exit: 1,
		manifest: { dependencies: { "@ui-sdk/react": 10 } },
		message: "invalid package dependency declarations",
	},
	{
		name: "only packages/ui may declare ui-sdk",
		file: "apps/web/src/index.ts",
		source: "export {};",
		exit: 1,
		manifest: { dependencies: { "@ui-sdk/react": "0.1.0" } },
	},
];

for (const fixture of fixtures) {
	test(`ui boundaries: ${fixture.name}`, async () => {
		const root = await mkdtemp(join(tmpdir(), "tripwire-ui-boundaries-"));
		try {
			const sourcePath = join(root, fixture.file);
			await mkdir(join(sourcePath, ".."), { recursive: true });
			await writeFile(sourcePath, fixture.source);
			const workspace = fixture.file.split("/").slice(0, 2).join("/");
			await writeFile(
				join(root, workspace, "package.json"),
				JSON.stringify(fixture.manifest ?? { name: "fixture" }),
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
				fixture.exit === 0
					? "ui boundary check passed"
					: "ui boundary check failed",
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
}
