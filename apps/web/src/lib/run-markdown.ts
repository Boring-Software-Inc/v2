import { ruleDisplayName } from "@tripwire/contracts";
import type { RunStepView, RunView } from "#/lib/runs.functions";

/**
 * Serialize a run as markdown for pasting into issues, Slack, or a PR. Pure:
 * resolved run-view model in, string out — no renderer, no fetch. It reads ONLY
 * the RunView, which is already the redacted public/full variant the page
 * shows, so the output cannot contain a url or secret the view stripped (the
 * delivery field carries a state + failure class, never the destination).
 *
 * `relativeTime` is passed in, not computed, so the serializer stays pure and
 * time-independent (the component supplies `formatRelativeTime(run.createdAt)`).
 */

const VERDICT_LABEL: Record<string, string> = {
	pass: "passed",
	block: "blocked",
	needs_review: "sent to review",
};

const STATUS_LABEL: Record<string, string> = {
	pass: "passed",
	fail: "failed",
	skipped: "skipped",
	paused: "review",
	pending: "queued",
};

function stepLabel(step: RunStepView): string {
	if (step.ruleRef) {
		return ruleDisplayName(step.ruleRef);
	}
	return step.label ?? step.nodeKind;
}

/** The human status word the page shows; unknown statuses pass through raw. */
function statusLabel(status: string): string {
	return STATUS_LABEL[status] ?? status;
}

/** Quote a possibly-multiline string, one `> ` per line (never just line one). */
function quote(text: string): string {
	return text
		.split("\n")
		.map((line) => `> ${line}`)
		.join("\n");
}

/** The delivery/status word for an action — a delivery action names its state. */
function actionStatus(action: RunView["actions"][number]): string {
	if (!action.delivery) {
		return action.status;
	}
	if (action.delivery.state === "failed") {
		return `failed: ${action.delivery.reason}`;
	}
	return action.delivery.state;
}

export function runToMarkdown(run: RunView, relativeTime: string): string {
	const verdict = run.verdict
		? (VERDICT_LABEL[run.verdict] ?? run.verdict)
		: run.status;
	const lines: string[] = [`# Run · ${verdict}`];

	// Header meta: repo, optional #pr, relative time, optional short sha.
	const meta = [`\`${run.repoFullName}\``];
	if (run.subjectNumber !== null) {
		meta[0] += ` #${run.subjectNumber}`;
	}
	meta.push(relativeTime);
	if (run.headSha) {
		meta.push(`\`${run.headSha.slice(0, 7)}\``);
	}
	lines.push(meta.join(" · "));

	if (run.steps.length > 0) {
		lines.push("", "### Steps");
		for (const step of run.steps) {
			lines.push(
				`**${stepLabel(step)}** · ${statusLabel(step.status)} · ${step.durationMs}ms`,
			);
			if (step.ruleRef) {
				lines.push(`\`${step.ruleRef}\``);
			}
			// Evidence is the rule's plain-English statement; omit when absent.
			const evidence = step.summary?.trim();
			if (evidence) {
				lines.push(quote(evidence));
			}
		}
	}

	if (run.actions.length > 0) {
		lines.push("", "### Actions");
		// Ordinal any action line that would otherwise duplicate — BOTH members
		// of a group get a number (never one bare + one numbered), so two
		// blocks read (1) and (2). Run order is inherent; this only disambiguates.
		const rendered = run.actions.map(
			(action) => `**${action.kind}** · ${actionStatus(action)}`,
		);
		const counts = new Map<string, number>();
		for (const line of rendered) {
			counts.set(line, (counts.get(line) ?? 0) + 1);
		}
		const seen = new Map<string, number>();
		for (const line of rendered) {
			if ((counts.get(line) ?? 0) > 1) {
				const n = (seen.get(line) ?? 0) + 1;
				seen.set(line, n);
				lines.push(`${line} (${n})`);
			} else {
				lines.push(line);
			}
		}
	}

	return lines.join("\n");
}
