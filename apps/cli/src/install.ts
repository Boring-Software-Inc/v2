import * as p from "@clack/prompts";
import pc from "picocolors";
import { type Agent, buildAgents } from "#/agents";
import { hostAgentId } from "#/agents/host";
import { formatCommand } from "#/agents/shell";
import { copyToClipboard } from "#/clipboard";
import { mcpUrl } from "#/config";
import type { MergeOutcome } from "#/json-config";
import { buildPrompt } from "#/prompt";
import {
	type Detection,
	detectAgents,
	type InstallResult,
	installAgent,
} from "#/run";
import type { System } from "#/system";

export interface InstallOptions {
	interactive: boolean;
	json: boolean;
	instruction?: string;
}

interface AgentReport {
	agent: Agent;
	result: InstallResult;
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

async function authenticate(
	system: System,
	reports: AgentReport[],
): Promise<boolean> {
	const done = reports.filter((report) => report.result.kind === "done");
	if (!done.some((report) => report.agent.login() !== null)) {
		return true;
	}
	const chosen = await p.multiselect({
		message: "Select agents to authenticate the Tripwire MCP for",
		options: done.map(({ agent }) => {
			const login = agent.login();
			return login
				? { value: agent.id, label: agent.name }
				: {
						value: agent.id,
						label: agent.name,
						hint: "Configure in app",
						disabled: true,
					};
		}),
		initialValues: done
			.filter(({ agent }) => agent.login() !== null)
			.map(({ agent }) => agent.id),
		required: false,
		showInstructions: false,
	});
	if (p.isCancel(chosen) || chosen.length === 0) {
		p.log.step("Authenticate the Tripwire MCP: skipped");
		return true;
	}
	let ok = true;
	for (const { agent } of done) {
		const login = agent.login();
		if (!(login && chosen.includes(agent.id))) {
			continue;
		}
		const shown = formatCommand(
			login.command.split(/[\\/]/).pop() ?? login.command,
			login.args,
		);
		p.log.step(`${agent.name}: ${shown}`);
		const result = await system.runInteractive(login.command, login.args);
		if (result.ok) {
			p.log.success(`${agent.name} authenticated`);
		} else {
			ok = false;
			p.log.error(
				`${agent.name} authentication failed${result.stderr ? `: ${result.stderr}` : ""}`,
			);
		}
	}
	return ok;
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
			? `${agent.name}, this session: do not run the login here. Ask the user to sign in with ${agent.signInHint}. Restart ${agent.name} first if tripwire is not listed.`
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
	const detections = await detectAgents(buildAgents(system));
	const written = new Map<string, MergeOutcome>();

	if (options.json) {
		const reports = await Promise.all(
			detections.map(async ({ agent }) => ({
				agent,
				result: await installAgent(agent, url, written),
			})),
		);
		const agents = reports.map(({ agent, result }) => ({
			id: agent.id,
			name: agent.name,
			thisSession: agent.id === host,
			signIn: agent.signInHint,
			...result,
		}));
		process.stdout.write(
			`${JSON.stringify({ mcpUrl: url, agents, prompt }, null, 2)}\n`,
		);
		return reports.every(({ result }) => result.kind === "done") ? 0 : 1;
	}

	process.stdout.write(`\n${banner()}\n\n`);
	p.intro(pc.dim("Setting up Tripwire in your coding agents"));
	if (detections.length === 0) {
		p.log.warn("No AI coding tools found");
		p.outro(
			"Install Claude Code, Codex, Cursor, VS Code, Devin Desktop or Grok, then run this again.",
		);
		return 1;
	}
	p.log.step(
		`Detected ${LIST.format(detections.map(({ agent }) => agent.name))}`,
	);

	let selected = detections;
	if (interactive) {
		const picked = await selectAgents(detections);
		if (picked === null) {
			p.cancel("Cancelled");
			return 1;
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
