import { spawnSync } from "node:child_process";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

interface OxlintDiagnostic {
	code: string;
	filename: string;
	message: string;
}

interface OxlintOutput {
	diagnostics: OxlintDiagnostic[];
}

const root = resolve(import.meta.dir, "../../..");
const fixtureRoot = resolve(import.meta.dir, "fixtures");
const temporaryRoot = resolve(root, "apps/web/src/__design-system-fixtures__");
const temporaryConfig = resolve(root, ".oxlint-design-system-fixtures.json");
const fixtures = [
	{ rule: "no-arbitrary-tailwind-values", diagnostics: 3 },
	{ rule: "no-direct-implementation-imports", diagnostics: 5 },
	{ rule: "no-inline-visual-styles", diagnostics: 2 },
	{ rule: "no-raw-color", diagnostics: 5 },
	{ rule: "no-raw-spacing", diagnostics: 3 },
	{ rule: "no-raw-typography", diagnostics: 4 },
] as const;

await mkdir(temporaryRoot, { recursive: true });
try {
	for (const fixture of fixtures) {
		await writeFile(
			temporaryConfig,
			JSON.stringify({
				jsPlugins: ["./scripts/oxlint/design-system/index.ts"],
				rules: { [`design-system/${fixture.rule}`]: "error" },
			}),
		);
		const source = resolve(fixtureRoot, `${fixture.rule}.tsx.fixture`);
		const target = resolve(temporaryRoot, `${fixture.rule}.tsx`);
		await cp(source, target);
		const result = spawnSync(
			resolve(root, "node_modules/.bin/oxlint"),
			["--config", temporaryConfig, "--format", "json", target],
			{
				cwd: root,
				encoding: "utf8",
				env: {
					...process.env,
					NODE_OPTIONS: "--experimental-strip-types",
				},
			},
		);
		const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
		let parsed: OxlintOutput;
		try {
			parsed = JSON.parse(result.stdout) as OxlintOutput;
		} catch {
			throw new Error(
				`${basename(source)} produced invalid Oxlint output:\n${output}`,
			);
		}
		const code = `design-system(${fixture.rule})`;
		const diagnostics = parsed.diagnostics.filter(
			(diagnostic) => diagnostic.code === code,
		);
		if (
			result.error ||
			result.status !== 1 ||
			diagnostics.length !== fixture.diagnostics
		) {
			throw new Error(
				`${basename(source)} expected ${fixture.diagnostics} ${code} diagnostics, received ${diagnostics.length}:\n${output}`,
			);
		}
		await rm(target);
		console.log(
			`fixture passed: ${fixture.rule} (${diagnostics.length} diagnostics)`,
		);
	}
} finally {
	await rm(temporaryRoot, { recursive: true, force: true });
	await rm(temporaryConfig, { force: true });
}
