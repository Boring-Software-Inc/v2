import { spawn } from "node:child_process";
import type { System } from "#/system";

function candidates(platform: NodeJS.Platform): string[][] {
	if (platform === "darwin") {
		return [["pbcopy"]];
	}
	if (platform === "win32") {
		return [["clip"]];
	}
	return [
		["wl-copy"],
		["xclip", "-selection", "clipboard"],
		["xsel", "--clipboard", "--input"],
	];
}

function pipeTo(
	binary: string,
	args: string[],
	text: string,
	env: NodeJS.ProcessEnv,
): Promise<boolean> {
	return new Promise((resolve) => {
		const child = spawn(binary, args, {
			env,
			stdio: ["pipe", "ignore", "ignore"],
		});
		child.on("error", () => resolve(false));
		child.on("exit", (code) => resolve(code === 0));
		child.stdin.on("error", () => undefined);
		child.stdin.end(text);
	});
}

export async function copyToClipboard(
	system: System,
	text: string,
): Promise<boolean> {
	for (const [command, ...args] of candidates(system.platform)) {
		const binary = command ? system.which(command) : null;
		if (binary && (await pipeTo(binary, args, text, system.env))) {
			return true;
		}
	}
	return false;
}
