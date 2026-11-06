import { Command, CommanderError } from "commander";
import { realAuthDeps } from "#/auth/device";
import { IS_STAGING, VERSION } from "#/config";
import { runInstall } from "#/install";
import { type ManageDeps, registerManageCommands } from "#/manage";
import type { System } from "#/system";

export async function main(system: System, argv: string[]): Promise<void> {
	const program = buildProgram(system);
	if (argv.length === 0) {
		program.outputHelp();
		return;
	}
	const json = argv.includes("--json");
	program.exitOverride();
	if (json) {
		program.configureOutput({ writeErr: () => undefined });
	}
	try {
		await program.parseAsync(argv, { from: "user" });
	} catch (error) {
		if (!(error instanceof CommanderError)) {
			throw error;
		}
		if (
			error.code === "commander.helpDisplayed" ||
			error.code === "commander.version"
		) {
			process.exitCode = 0;
			return;
		}
		process.exitCode = 2;
		if (json) {
			process.stderr.write(
				`${JSON.stringify({ error: { code: "USAGE_ERROR", message: error.message } })}\n`,
			);
		}
	}
}

async function openUrl(system: System, url: string): Promise<void> {
	const openers =
		system.platform === "darwin"
			? [["open", url]]
			: system.platform === "win32"
				? [["cmd", "/c", "start", "", url]]
				: system.env.WSL_INTEROP
					? [
							["wslview", url],
							["rundll32.exe", "url.dll,FileProtocolHandler", url],
							["xdg-open", url],
						]
					: [["xdg-open", url]];
	for (const [command, ...args] of openers) {
		const binary = command ? system.which(command) : null;
		if (binary && (await system.run(binary, args)).ok) return;
	}
}

export function buildProgram(
	system: System,
	overrides: Partial<ManageDeps> = {},
) {
	const program = new Command()
		.name("tripwire")
		.description(
			IS_STAGING
				? "Set up and manage Tripwire staging"
				: "Set up Tripwire in your coding agents and manage it from the terminal",
		)
		.version(VERSION)
		.option("--json", "Print machine-readable JSON")
		.option(
			"--org <slug>",
			"Org to act on (default: TRIPWIRE_ORG, the linked project, or your only org)",
		)
		.showHelpAfterError();

	program
		.command("install [instruction]")
		.description(
			"Add the Tripwire MCP server and get-started skill to your coding agents. " +
				"instruction is org-slug#run-code or text for the copied prompt",
		)
		.option(
			"--agent <id>",
			"Install into this agent; repeat to select more than one",
			(value: string, previous: string[]) => [...previous, value],
			[],
		)
		.option("--all", "Select every detected agent")
		.option("-y, --yes", "Confirm an explicit --all selection")
		.action(
			async (
				instruction: string | undefined,
				opts: { agent: string[]; all?: boolean; yes?: boolean },
				command: Command,
			) => {
				const json =
					command.optsWithGlobals<{ json?: boolean }>().json === true;
				const tty =
					process.stdin.isTTY === true && process.stderr.isTTY === true;
				process.exitCode = await runInstall(system, {
					interactive: tty,
					json,
					instruction,
					agentIds: opts.agent,
					all: opts.all === true,
					yes: opts.yes === true,
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
