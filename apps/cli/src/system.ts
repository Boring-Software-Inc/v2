import { spawn } from "node:child_process";
import { accessSync, constants, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

export interface RunResult {
	ok: boolean;
	stdout: string;
	stderr: string;
}

export interface System {
	platform: NodeJS.Platform;
	home: string;
	env: NodeJS.ProcessEnv;
	macAppDirs: string[];
	run(command: string, args: string[], input?: string): Promise<RunResult>;
	runInteractive(command: string, args: string[]): Promise<RunResult>;
	which(binary: string): string | null;
	exists(path: string): boolean;
	list(dir: string): string[];
}

function isExecutable(path: string): boolean {
	try {
		accessSync(path, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

function findOnPath(
	binary: string,
	env: NodeJS.ProcessEnv,
	platform: NodeJS.Platform,
): string | null {
	const dirs = (env.PATH ?? "").split(delimiter).filter(Boolean);
	const extensions =
		platform === "win32"
			? (env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").filter(Boolean)
			: [""];
	for (const dir of dirs) {
		for (const extension of extensions) {
			const candidate = join(dir, `${binary}${extension}`);
			if (existsSync(candidate) && isExecutable(candidate)) {
				return candidate;
			}
		}
	}
	return null;
}

function capture(
	command: string,
	args: string[],
	env: NodeJS.ProcessEnv,
	input?: string,
): Promise<RunResult> {
	return new Promise((resolve) => {
		const child = spawn(command, args, {
			env,
			stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
		});
		if (input !== undefined && child.stdin) {
			child.stdin.on("error", () => undefined);
			child.stdin.end(input);
		}
		let stdout = "";
		let stderr = "";
		child.stdout?.setEncoding("utf8");
		child.stderr?.setEncoding("utf8");
		child.stdout?.on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.stderr?.on("data", (chunk: string) => {
			stderr += chunk;
		});
		child.on("error", (error) =>
			resolve({ ok: false, stdout, stderr: error.message }),
		);
		child.on("close", (code) =>
			resolve({ ok: code === 0, stdout: stdout.trim(), stderr: stderr.trim() }),
		);
	});
}

function inherit(
	command: string,
	args: string[],
	env: NodeJS.ProcessEnv,
): Promise<RunResult> {
	return new Promise((resolve) => {
		const child = spawn(command, args, { env, stdio: "inherit" });
		child.on("error", (error) =>
			resolve({ ok: false, stdout: "", stderr: error.message }),
		);
		child.on("close", (code) =>
			resolve({ ok: code === 0, stdout: "", stderr: "" }),
		);
	});
}

function listDir(dir: string): string[] {
	try {
		return readdirSync(dir);
	} catch {
		return [];
	}
}

function macAppDirs(env: NodeJS.ProcessEnv, home: string): string[] {
	if (env.TRIPWIRE_APP_DIRS !== undefined) {
		return env.TRIPWIRE_APP_DIRS.split(delimiter).filter(Boolean);
	}
	return ["/Applications", join(home, "Applications")];
}

export function realSystem(
	env: NodeJS.ProcessEnv = process.env,
	platform: NodeJS.Platform = process.platform,
): System {
	const home = env.HOME ?? env.USERPROFILE ?? homedir();
	return {
		platform,
		home,
		env,
		macAppDirs: macAppDirs(env, home),
		run: (command, args, input) => capture(command, args, env, input),
		runInteractive: (command, args) => inherit(command, args, env),
		which: (binary) => findOnPath(binary, env, platform),
		exists: existsSync,
		list: listDir,
	};
}
