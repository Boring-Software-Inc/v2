import { Command } from "commander";
import { realAuthDeps } from "#/auth/device";
import { VERSION } from "#/config";
import { runInstall } from "#/install";
import { type ManageDeps, registerManageCommands } from "#/manage";
import type { System } from "#/system";

const COMMANDS = new Set([
	"install",
	"login",
	"logout",
	"whoami",
	"status",
	"repos",
	"rules",
	"gate",
	"workflows",
	"runs",
	"queue",
	"help",
]);
const PASSTHROUGH = new Set(["--help", "-h", "--version", "-V"]);

const VALUE_OPTIONS = new Set(["--org"]);

export function withDefaultCommand(argv: string[]): string[] {
	if (argv.some((arg) => PASSTHROUGH.has(arg))) {
		return argv;
	}
	let index = 0;
	while (index < argv.length) {
		const arg = argv[index] ?? "";
		if (!arg.startsWith("-")) {
			break;
		}
		index += VALUE_OPTIONS.has(arg) ? 2 : 1;
	}
	const first = argv[index];
	if (first !== undefined && COMMANDS.has(first)) {
		return argv;
	}
	return ["install", ...argv];
}

async function openUrl(system: System, url: string): Promise<void> {
	const opener =
		system.platform === "darwin"
			? ["open", url]
			: system.platform === "win32"
				? ["cmd", "/c", "start", "", url]
				: ["xdg-open", url];
	const [command, ...args] = opener;
	const binary = command ? system.which(command) : null;
	if (binary) {
		await system.run(binary, args);
	}
}

export function buildProgram(
	system: System,
	overrides: Partial<ManageDeps> = {},
) {
	const program = new Command()
		.name("tripwire")
		.description(
			"Set up Tripwire in your coding agents and manage it from the terminal",
		)
		.version(VERSION)
		.option("--json", "Print machine-readable JSON")
		.option(
			"--org <slug>",
			"Org to act on (default: TRIPWIRE_ORG or your only org)",
		)
		.showHelpAfterError();

	program
		.command("install [instruction]")
		.description(
			"Add the Tripwire MCP server and get-started skill to your coding agents. " +
				"instruction is org-slug#run-code or text for the copied prompt",
		)
		.option(
			"--no-interactive",
			"Install into every detected agent without prompts",
		)
		.option("-y, --yes", "Alias for --no-interactive")
		.action(
			async (
				instruction: string | undefined,
				opts: { interactive: boolean; yes?: boolean },
				command: Command,
			) => {
				const json =
					command.optsWithGlobals<{ json?: boolean }>().json === true;
				const tty =
					process.stdin.isTTY === true && process.stdout.isTTY === true;
				process.exitCode = await runInstall(system, {
					interactive: opts.interactive && !opts.yes && tty,
					json,
					instruction,
				});
			},
		);

	registerManageCommands(program, {
		system,
		auth: realAuthDeps,
		openUrl: (url) => openUrl(system, url),
		...overrides,
	});
	return program;
}
