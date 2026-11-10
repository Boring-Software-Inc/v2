import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { confirm, isCancel } from "@clack/prompts";
import { z } from "zod";
import { IS_STAGING } from "#/config";
import type { System } from "#/system";
import { npmCommand, runChild } from "#/update";
import {
	SDK_PACKAGE,
	supportsWorkflowSdk,
	type WorkflowSdkUpgradeRequired,
} from "#/workflows-code";

const dependencyMap = z.record(z.string(), z.string()).optional();
const projectManifest = z.object({
	packageManager: z.string().optional(),
	dependencies: dependencyMap,
	devDependencies: dependencyMap,
	optionalDependencies: dependencyMap,
});

function sdkProject(file: string) {
	for (let cwd = dirname(file); ; cwd = dirname(cwd)) {
		const path = join(cwd, "package.json");
		if (existsSync(path)) {
			const manifest = projectManifest.parse(
				JSON.parse(readFileSync(path, "utf8")),
			);
			const optional = manifest.optionalDependencies?.[SDK_PACKAGE];
			const dev = manifest.devDependencies?.[SDK_PACKAGE];
			const spec = optional ?? dev ?? manifest.dependencies?.[SDK_PACKAGE];
			if (spec) {
				if (!/^(?:[~^]?\d+\.\d+\.\d+(?:-[\w.-]+)?|latest|staging)$/.test(spec))
					return undefined;
				return {
					cwd,
					manifest,
					section: optional ? "optional" : dev ? "dev" : "prod",
				};
			}
		}
		if (dirname(cwd) === cwd) return undefined;
	}
}

function packageManager(
	project: NonNullable<ReturnType<typeof sdkProject>>,
): string {
	const declared = project.manifest.packageManager?.split("@")[0];
	if (declared) return declared;
	const { cwd } = project;
	if (
		existsSync(join(cwd, "pnpm-lock.yaml")) ||
		existsSync(join(cwd, "yarn.lock"))
	)
		return "other";
	if (existsSync(join(cwd, "bun.lock")) || existsSync(join(cwd, "bun.lockb")))
		return "bun";
	return "npm";
}

async function availableSdk(
	minimum: WorkflowSdkUpgradeRequired["minimum"],
): Promise<string | undefined> {
	for (const tag of IS_STAGING ? ["staging", "latest"] : ["latest"]) {
		try {
			const response = await fetch(
				`https://registry.npmjs.org/@tripwire-sh%2fsdk/${tag}`,
				{
					signal: AbortSignal.timeout(1_500),
					redirect: "error",
				},
			);
			if (!response.ok) continue;
			const { version } = z
				.object({ name: z.literal(SDK_PACKAGE), version: z.string() })
				.parse(await response.json());
			if (supportsWorkflowSdk(version, minimum)) return version;
		} catch {}
	}
	return undefined;
}

export async function offerWorkflowSdkUpgrade(
	system: System,
	upgrade: WorkflowSdkUpgradeRequired,
): Promise<number> {
	const project = sdkProject(upgrade.file);
	if (!project) throw upgrade;
	const manager = packageManager(project);
	const bun = manager === "bun" ? system.which("bun") : null;
	const npm = manager === "npm" ? npmCommand(system) : undefined;
	if (!(bun || npm)) throw upgrade;
	const version = await availableSdk(upgrade.minimum);
	if (!version) throw upgrade;

	const accepted = await confirm({
		message: `Tripwire SDK ${upgrade.installed} → ${version}. Update with ${manager} and continue pulling?`,
		initialValue: true,
		output: process.stderr,
	});
	if (isCancel(accepted) || !accepted) return 130;

	const target = `${SDK_PACKAGE}@${version}`;
	const { section, cwd } = project;
	let command: string;
	let args: string[];
	if (bun) {
		command = bun;
		args = ["add", "--exact", "--ignore-scripts"];
		if (section !== "prod")
			args.push(section === "dev" ? "--dev" : "--optional");
	} else if (npm) {
		const [binary, ...prefix] = npm;
		command = binary;
		args = [
			...prefix,
			"install",
			"--global=false",
			"--save-exact",
			"--no-audit",
			"--no-fund",
			"--ignore-scripts",
		];
		if (section !== "prod")
			args.push(section === "dev" ? "--save-dev" : "--save-optional");
	} else {
		throw upgrade;
	}
	process.stderr.write(`Installing ${target}…\n`);
	const code = await runChild(
		command,
		[...args, target],
		system.env,
		true,
		cwd,
	);
	if (code === 130) return code;
	if (code !== 0) {
		throw new Error(
			`Couldn’t install ${target}. Check the ${manager} output and try again.`,
		);
	}
	return 0;
}
