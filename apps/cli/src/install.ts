import * as p from "@clack/prompts";
import pc from "picocolors";
import { type Agent, buildAgents } from "#/agents";
import { hostAgentId } from "#/agents/host";
import { formatCommand } from "#/agents/shell";
import type { LoginCommand } from "#/agents/types";
import { copyToClipboard } from "#/clipboard";
import { mcpUrl, SERVER_NAME } from "#/config";
import { errorLine, styleFor } from "#/format";
import type { MergeOutcome } from "#/json-config";
import { buildPrompt } from "#/prompt";
import {
	type Detection,
	detectAgents,
	type InstallResult,
	installAgent,
} from "#/run";
import { planSignIns, runSignIns, type SignInResult } from "#/sign-in";
import type { System } from "#/system";

export interface InstallOptions {
	interactive: boolean;
	json: boolean;
	instruction?: string;
	agentIds: string[];
	all: boolean;
	yes: boolean;
}

interface AgentReport {
	agent: Agent;
	result: InstallResult;
}

/** Returns the usage error before installation can touch any agent configuration. */
export function installSelectionError(
	options: Pick<InstallOptions, "agentIds" | "all" | "yes" | "interactive">,
	detectedIds?: readonly string[],
): string | null {
	if (options.agentIds.length > 0 && options.all) {
		return "Use --agent or --all, not both.";
	}
	if (options.all && !options.yes) {
		return "--all requires --yes.";
	}
	if (!options.interactive && options.agentIds.length === 0 && !options.all) {
		return "Non-interactive installation requires --agent <id> or --all --yes.";
	}
	if (detectedIds === undefined) {
		return null;
	}
	const unknown = [...new Set(options.agentIds)].filter(
		(id) => !detectedIds.includes(id),
	);
	return unknown.length > 0
		? `No detected agent matches: ${unknown.join(", ")}.`
		: null;
}

const LIST = new Intl.ListFormat("en", { style: "long", type: "conjunction" });

function tildify(system: System, text: string): string {
	return text.split(system.home).join("~");
}

function describe(system: System, report: AgentReport): string {
	const { result } = report;
	if (result.kind === "failed") {
		return pc.red(result.message);
	}
	const lines = [
		`${pc.dim("mcp  ")} ${tildify(system, result.mcp.target)} ${pc.dim(`(${result.mcp.outcome})`)}`,
	];
	if (result.skills.length === 0) {
		lines.push(`${pc.dim("skill")} ${pc.dim("not supported, MCP only")}`);
	}
	for (const skill of result.skills) {
		lines.push(
			`${pc.dim("skill")} ${tildify(system, skill.path)} ${pc.dim(`(${skill.outcome})`)}`,
		);
	}
	return lines.join("\n");
}

function banner(): string {
	return pc.bgRed(pc.black(pc.bold(" tripwire ")));
}

function jsonError(
	code: "USAGE_ERROR" | "INSTALL_FAILED",
	message: string,
	details?: unknown,
): void {
	process.stderr.write(
		`${JSON.stringify({ error: { code, message, ...(details === undefined ? {} : { details }) } })}\n`,
	);
}

function installError(
	system: System,
	options: InstallOptions,
	code: "USAGE_ERROR" | "INSTALL_FAILED",
	message: string,
	details?: unknown,
): number {
	if (options.json) {
		jsonError(code, message, details);
	} else {
		process.stderr.write(
			`${errorLine(message, styleFor(process.stderr.isTTY === true, system.env))}\n`,
		);
	}
	return code === "USAGE_ERROR" ? 2 : 1;
}

async function selectAgents(
	detections: Detection[],
): Promise<Detection[] | null> {
	const chosen = await p.multiselect({
		message: "Select the agents to set up Tripwire for",
		options: detections.map((detection) => ({
			value: detection.agent.id,
			label: detection.installed
				? `${detection.agent.name} (reinstall)`
				: detection.agent.name,
		})),
		initialValues: detections.map((detection) => detection.agent.id),
		required: false,
		showInstructions: false,
	});
	if (p.isCancel(chosen)) {
		return null;
	}
	return detections.filter((detection) => chosen.includes(detection.agent.id));
}

function loginLine(login: LoginCommand): string {
	return formatCommand(
		login.command.split(/[\\/]/).pop() ?? login.command,
		login.args,
	);
}

function signInLine(result: SignInResult): string {
	switch (result.outcome) {
		case "signed-in":
			return "signed in";
		case "already":
			return "already signed in";
		case "failed":
			return result.login
				? `not signed in, run ${loginLine(result.login)}`
				: "not signed in";
		case "manual":
			return `sign in with ${result.agent.signInHint}`;
	}
}

function summarize(results: SignInResult[]): void {
	const width = Math.max(...results.map(({ agent }) => agent.name.length));
	const lines = results.map(
		(result) => `${result.agent.name.padEnd(width)}  ${signInLine(result)}`,
	);
	const log = results.some(({ outcome }) => outcome === "failed")
		? p.log.warn
		: p.log.info;
	log(`Tripwire sign-in\n${lines.join("\n")}`);
}

async function authenticate(
	system: System,
	reports: AgentReport[],
): Promise<boolean> {
	const agents = reports
		.filter((report) => report.result.kind === "done")
		.map(({ agent }) => agent);
	if (agents.length === 0) {
		return true;
	}
	const checking = agents.some((agent) => agent.login() !== null);
	const spin = checking ? p.spinner() : null;
	spin?.start("Checking Tripwire sign-in");
	const plans = await planSignIns(agents);
	spin?.stop("Checked Tripwire sign-in");
	const results = await runSignIns(plans, async ({ agent, login }) => {
		p.log.step(`${agent.name}: ${loginLine(login)}`);
		return system.runInteractive(login.command, login.args);
	});
	summarize(results);
	return results.every(({ outcome }) => outcome !== "failed");
}

function nextSteps(
	reports: AgentReport[],
	host: string | null,
	prompt: string,
): void {
	const done = reports.filter(({ result }) => result.kind === "done");
	if (done.length === 0) {
		return;
	}
	const lines = done.map(({ agent }) =>
		agent.id === host
			? `${agent.name}, this session: do not run the login here. Ask the user to sign in with ${agent.signInHint}. Restart ${agent.name} first if ${SERVER_NAME} is not listed.`
			: `${agent.name}: ${agent.signInHint}`,
	);
	p.log.info(`Sign in to the Tripwire MCP\n${lines.join("\n")}`);
	p.log.info(`Then send this prompt\n${prompt}`);
}

async function offerPrompt(system: System, prompt: string): Promise<void> {
	const wants = await p.confirm({
		message: "Copy a prompt to get started with Tripwire?",
		initialValue: true,
	});
	if (p.isCancel(wants) || !wants) {
		p.log.step("Maybe next time");
		return;
	}
	const copied = await copyToClipboard(system, prompt);
	p.log.success(
		copied
			? "Copied a get-started prompt to your clipboard"
			: "Copy this prompt to get started",
	);
	p.log.message(pc.gray(prompt));
}

export async function runInstall(
	system: System,
	options: InstallOptions,
): Promise<number> {
	const url = mcpUrl(system.env);
	const prompt = buildPrompt(options.instruction);
	const host = hostAgentId(system.env);
	const interactive = options.interactive && !options.json && host === null;
	const selectionOptions = { ...options, interactive };
	const syntaxError = installSelectionError(selectionOptions);
	if (syntaxError) {
		return installError(system, options, "USAGE_ERROR", syntaxError);
	}
	const detections = await detectAgents(buildAgents(system));
	const written = new Map<string, MergeOutcome>();
	const selectionError = installSelectionError(
		selectionOptions,
		detections.map(({ agent }) => agent.id),
	);
	if (selectionError) {
		return installError(system, options, "USAGE_ERROR", selectionError);
	}
	const requested = new Set(options.agentIds);

	if (detections.length === 0) {
		if (options.json) {
			return installError(
				system,
				options,
				"INSTALL_FAILED",
				"No supported coding agents were detected.",
			);
		}
		process.stdout.write(`\n${banner()}\n\n`);
		p.intro(pc.dim("Setting up Tripwire in your coding agents"));
		p.log.warn("No AI coding tools found");
		p.outro("Install a supported coding agent, then run this again.");
		return 1;
	}
	if (!options.json) {
		process.stdout.write(`\n${banner()}\n\n`);
		p.intro(pc.dim("Setting up Tripwire in your coding agents"));
		p.log.step(
			`Detected ${LIST.format(detections.map(({ agent }) => agent.name))}`,
		);
	}

	let selected = options.all
		? detections
		: detections.filter(({ agent }) => requested.has(agent.id));
	if (interactive && options.agentIds.length === 0 && !options.all) {
		const picked = await selectAgents(detections);
		if (picked === null) {
			p.cancel("Cancelled");
			return 130;
		}
		selected = picked;
	}
	if (selected.length === 0) {
		p.outro("No agents selected");
		return 0;
	}

	const spin = interactive ? p.spinner() : null;
	spin?.start("Installing the Tripwire MCP and skill");
	const reports = await Promise.all(
		selected.map(async ({ agent }) => ({
			agent,
			result: await installAgent(agent, url, written),
		})),
	);
	if (options.json) {
		const agents = reports.map(({ agent, result }) => ({
			id: agent.id,
			name: agent.name,
			thisSession: agent.id === host,
			signIn: agent.signInHint,
			...result,
		}));
		if (reports.some(({ result }) => result.kind === "failed")) {
			return installError(
				system,
				options,
				"INSTALL_FAILED",
				"Tripwire was not installed in every selected agent.",
				{ agents },
			);
		}
		process.stdout.write(
			`${JSON.stringify({ mcpUrl: url, agents, prompt })}\n`,
		);
		return 0;
	}
	spin?.stop("Installed the Tripwire MCP and skill");
	if (!spin) {
		p.log.step("Installed the Tripwire MCP and skill");
	}
	for (const report of reports) {
		const log = report.result.kind === "done" ? p.log.success : p.log.error;
		log(`${report.agent.name}\n${describe(system, report)}`);
	}

	let authOk = true;
	if (interactive) {
		authOk = await authenticate(system, reports);
		if (reports.some(({ result }) => result.kind === "done")) {
			await offerPrompt(system, prompt);
		}
	} else {
		nextSteps(reports, host, prompt);
	}

	const affected = reports
		.filter(({ result }) => result.kind === "done")
		.map(({ agent }) => agent.name);
	if (affected.length > 0) {
		p.outro(`Done. Restart ${LIST.format(affected)}.`);
	} else {
		p.outro("Nothing was installed");
	}
	const allOk = reports.every(({ result }) => result.kind === "done");
	return allOk && authOk ? 0 : 1;
}
