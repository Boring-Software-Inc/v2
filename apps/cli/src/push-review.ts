import {
	WORKFLOW_PUSH_MAX_WAIT_SECONDS,
	type WorkflowPushView,
} from "@tripwire/contracts";
import { errorLine, pairs, type Style } from "#/format";

const TRUTHY = new Set(["1", "true", "yes"]);

function flag(value: string | undefined): boolean {
	return value !== undefined && TRUTHY.has(value.trim().toLowerCase());
}

export function canOpenBrowser(
	env: NodeJS.ProcessEnv,
	platform: NodeJS.Platform,
): boolean {
	if (flag(env.TRIPWIRE_NO_BROWSER) || env.BROWSER === "none") {
		return false;
	}
	if (flag(env.CI)) {
		return false;
	}
	const display = Boolean(env.DISPLAY || env.WAYLAND_DISPLAY);
	if ((env.SSH_CONNECTION || env.SSH_TTY) && !display) {
		return false;
	}
	if (platform === "darwin" || platform === "win32") {
		return true;
	}
	return display;
}

export interface WaitDeps {
	read(waitSeconds: number): Promise<WorkflowPushView>;
	sleep(ms: number): Promise<void>;
}

const RETRY_MS = 2000;
const MAX_FAILURES = 5;

export async function waitForDecision(
	first: WorkflowPushView,
	deps: WaitDeps,
): Promise<WorkflowPushView> {
	let view = first;
	let failures = 0;
	while (view.status === "pending") {
		try {
			view = await deps.read(WORKFLOW_PUSH_MAX_WAIT_SECONDS);
			failures = 0;
		} catch (error) {
			failures += 1;
			if (failures >= MAX_FAILURES) {
				throw error;
			}
			await deps.sleep(RETRY_MS);
		}
	}
	return view;
}

function workflowCount(count: number): string {
	return `${count} ${count === 1 ? "workflow" : "workflows"}`;
}

export function waitingText(view: WorkflowPushView): string {
	return `Waiting for someone to accept ${workflowCount(view.workflows.length)} on ${view.repo}`;
}

export function outcomeText(view: WorkflowPushView, style: Style): string {
	return pairs(
		view.workflows.map((workflow): [string, string] => [
			workflow.outcome ?? "skipped",
			[workflow.name, workflow.url].filter(Boolean).join("  "),
		]),
		style,
	);
}

export function pushRefusalText(view: WorkflowPushView, repo: string): string {
	switch (view.status) {
		case "rejected":
			return "The push was rejected. Nothing was saved.";
		case "expired":
			return "The review link expired. Nothing was saved. Push again.";
		case "stale":
			return `These workflows changed on the server after the push. Nothing was saved. Run tripwire workflows diff ${repo}, then push again.`;
		default:
			return "The push was not accepted. Nothing was saved.";
	}
}

export function blockedText(
	workflows: readonly { name: string; issues: readonly string[] }[],
	style: Style,
): string {
	return workflows
		.map((workflow) =>
			errorLine(
				`${workflow.name} was not sent for review. ${workflow.issues.join(" ")}`,
				style,
			),
		)
		.join("\n");
}
