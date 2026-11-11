import { spawn } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
} from "node:fs";
import { constants, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { confirm, isCancel } from "@clack/prompts";
import { z } from "zod";
import { VERSION } from "#/config";
import type { System } from "#/system";

const PACKAGE = "@tripwire-sh/cli";
const REGISTRY = "https://registry.npmjs.org";
const SKIP_UPDATE = "TRIPWIRE_NO_UPDATE";
const releasePattern =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-staging\.([1-9]\d*))?$/;
const packageVersion = z.object({
	name: z.literal(PACKAGE),
	version: z.string(),
});

function release(version: string) {
	const parts = releasePattern.exec(version);
	if (!parts) return null;
	const order = [parts[1], parts[2], parts[3], parts[4] ?? "0"].map(Number);
	return order.every(Number.isSafeInteger)
		? { order, staging: Boolean(parts[4]) }
		: null;
}

export function isNewerCliRelease(current: string, candidate: string): boolean {
	const installed = release(current);
	const available = release(candidate);
	if (!installed || !available || installed.staging !== available.staging)
		return false;
	const difference = available.order.findIndex(
		(part, index) => part !== installed.order[index],
	);
	return (
		difference >= 0 &&
		(available.order[difference] ?? 0) > (installed.order[difference] ?? 0)
	);
}

function installedPackage(entry: string): string | undefined {
	try {
		const file = realpathSync(entry);
		const pkg = dirname(dirname(file));
		return basename(file) === "tripwire.js" &&
			basename(dirname(file)) === "dist" &&
			basename(pkg) === "cli" &&
			basename(dirname(pkg)) === "@tripwire-sh" &&
			basename(dirname(dirname(pkg))) === "node_modules"
			? pkg
			: undefined;
	} catch {
		return undefined;
	}
}

export function npmCommand(system: System): [string, ...string[]] | undefined {
	const npm = system.which("npm");
	if (system.platform !== "win32") return npm ? [npm] : undefined;
	const fromEnv = system.env.npm_execpath;
	const npmCli = [
		fromEnv && basename(fromEnv) === "npm-cli.js" ? fromEnv : undefined,
		npm && join(dirname(npm), "node_modules", "npm", "bin", "npm-cli.js"),
		join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
	].find((path) => path && existsSync(path));
	return npmCli ? [process.execPath, npmCli] : undefined;
}

async function newerVersion(): Promise<string | undefined> {
	const tag = release(VERSION)?.staging ? "staging" : "latest";
	try {
		const response = await fetch(`${REGISTRY}/@tripwire-sh%2fcli/${tag}`, {
			signal: AbortSignal.timeout(850),
			redirect: "error",
		});
		if (!response.ok) return undefined;
		const parsed = packageVersion.safeParse(await response.json());
		return parsed.success && isNewerCliRelease(VERSION, parsed.data.version)
			? parsed.data.version
			: undefined;
	} catch {
		return undefined;
	}
}

export function runChild(
	command: string,
	args: string[],
	env: NodeJS.ProcessEnv,
	updating = false,
	cwd?: string,
): Promise<number> {
	return new Promise((resolve) => {
		const child = spawn(command, args, {
			env,
			cwd,
			stdio: updating ? ["inherit", process.stderr, "inherit"] : "inherit",
		});
		child.once("error", () => resolve(1));
		child.once("close", (code, signal) =>
			resolve(code ?? (signal ? 128 + constants.signals[signal] : 1)),
		);
	});
}

async function isGlobalInstall(
	system: System,
	npm: [string, ...string[]],
	pkg: string,
): Promise<boolean> {
	try {
		const [command, ...prefix] = npm;
		const result = await system.run(command, [
			...prefix,
			"root",
			"--global",
			"--silent",
		]);
		return result.ok && realpathSync(join(result.stdout, PACKAGE)) === pkg;
	} catch {
		return false;
	}
}

export async function updateCli(
	system: System,
	argv: string[],
): Promise<number | undefined> {
	if (
		system.env[SKIP_UPDATE] ||
		system.env.CI ||
		argv.includes("--json") ||
		!process.stdin.isTTY ||
		!process.stdout.isTTY ||
		!process.stderr.isTTY
	) {
		return undefined;
	}
	const pkg = installedPackage(process.argv[1] ?? "");
	if (!pkg) return undefined;
	const npm = npmCommand(system);
	if (!npm) return undefined;
	const version = await newerVersion();
	if (!version) return undefined;
	const global = await isGlobalInstall(system, npm, pkg);
	const accepted = await confirm({
		message: `Tripwire ${VERSION} → ${version}. ${global ? "Update and continue?" : "Use the update for this command?"}`,
		initialValue: true,
		output: process.stderr,
	});
	if (isCancel(accepted)) return 130;
	if (!accepted) return undefined;

	let temp: string | undefined;
	try {
		if (!global) temp = mkdtempSync(join(tmpdir(), "tripwire-cli-update-"));
		const [command, ...prefix] = npm;
		const location = temp
			? ["--prefix", temp, "--no-save", "--no-package-lock"]
			: ["--global"];
		process.stderr.write(`Installing Tripwire ${version}…\n`);
		const code = await runChild(
			command,
			[
				...prefix,
				"install",
				...location,
				"--no-audit",
				"--no-fund",
				"--ignore-scripts",
				`--registry=${REGISTRY}`,
				`${PACKAGE}@${version}`,
			],
			system.env,
			true,
		);
		if (code === 130) return code;
		if (code !== 0) throw new Error("npm install failed");
		const updated = temp ? join(temp, "node_modules", PACKAGE) : pkg;
		const manifest = packageVersion.parse(
			JSON.parse(readFileSync(join(updated, "package.json"), "utf8")),
		);
		const entry = join(updated, "dist", "tripwire.js");
		if (manifest.version !== version || !existsSync(entry))
			throw new Error("Updated CLI not found");
		process.stderr.write(`Continuing with Tripwire ${version}.\n`);
		return await runChild(process.execPath, [entry, ...argv], {
			...system.env,
			[SKIP_UPDATE]: "1",
		});
	} catch {
		process.stderr.write(
			"Couldn’t update Tripwire. Check the npm output and try again.\n",
		);
		return 1;
	} finally {
		if (temp) {
			try {
				rmSync(temp, { recursive: true, force: true });
			} catch {
				/** An OS lock must not change the resumed command’s result. */
			}
		}
	}
}
