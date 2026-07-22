import { describe, expect, test } from "bun:test";
import { runToMarkdown } from "./run-markdown";
import type { RunView } from "./runs.functions";

function makeRun(over: Partial<RunView> = {}): RunView {
	return {
		id: "run-1",
		repoFullName: "acme/web",
		subjectNumber: 83,
		headSha: "8de51ef9f624c5d35fe48b55f6cc5486eecf5672",
		status: "completed",
		verdict: "block",
		createdAt: "2026-07-21T00:00:00.000Z",
		completedAt: "2026-07-21T00:00:01.000Z",
		snapshot: null,
		access: "full",
		rerun: false,
		rerunBy: null,
		steps: [],
		actions: [],
		...over,
	};
}

const step = (over: Partial<RunView["steps"][number]> = {}) => ({
	id: "s",
	nodeId: "wf:n",
	nodeKind: "rule",
	ruleRef: null,
	status: "pass",
	evidence: null,
	output: null,
	durationMs: 0,
	startedAt: "2026-07-21T00:00:00.000Z",
	...over,
});

describe("runToMarkdown", () => {
	test("header: verdict, repo, pr, relative time, short sha", () => {
		const md = runToMarkdown(makeRun(), "just now");
		expect(md).toContain("# Run · blocked");
		expect(md).toContain("`acme/web` #83 · just now · `8de51ef`");
	});

	test("a rule step renders label, status, duration, ref, and quoted evidence", () => {
		const md = runToMarkdown(
			makeRun({
				steps: [
					step({
						ruleRef: "account-age@1",
						status: "fail",
						durationMs: 4,
						summary: "your account is 1260 days old",
					}),
				],
			}),
			"just now",
		);
		expect(md).toContain("### Steps");
		expect(md).toContain("**account age** · failed · 4ms");
		expect(md).toContain("`account-age@1`");
		expect(md).toContain("> your account is 1260 days old");
	});

	test("a non-rule step uses its resolved label and has no ref line", () => {
		const md = runToMarkdown(
			makeRun({ steps: [step({ nodeKind: "action", label: "webhook" })] }),
			"just now",
		);
		expect(md).toContain("**webhook** · passed · 0ms");
		expect(md).not.toContain("`null`");
	});

	test("a step with no evidence omits the > line", () => {
		const md = runToMarkdown(
			makeRun({ steps: [step({ label: "trigger", nodeKind: "trigger" })] }),
			"just now",
		);
		expect(md).not.toContain(">");
	});

	test("multiline evidence is quoted on every line", () => {
		const md = runToMarkdown(
			makeRun({
				steps: [
					step({
						ruleRef: "ai-review@2",
						status: "fail",
						summary: "line one\nline two\nline three",
					}),
				],
			}),
			"just now",
		);
		expect(md).toContain("> line one\n> line two\n> line three");
	});

	test("a run with no actions omits the ### Actions header", () => {
		const md = runToMarkdown(makeRun({ steps: [step()] }), "just now");
		expect(md).not.toContain("### Actions");
	});

	test("a delivery-failed action renders failed:reason, never delivered", () => {
		const md = runToMarkdown(
			makeRun({
				actions: [
					{
						kind: "webhook",
						status: "recorded",
						recordedAt: "2026-07-21T00:00:00.000Z",
						delivery: { state: "failed", reason: "http-error" },
					},
				],
			}),
			"just now",
		);
		expect(md).toContain("**webhook** · failed: http-error");
		expect(md).not.toContain("delivered");
		expect(md).not.toContain("recorded");
	});

	test("sent and queued deliveries render their state", () => {
		const md = runToMarkdown(
			makeRun({
				actions: [
					{
						kind: "webhook",
						status: "executed",
						recordedAt: "t",
						delivery: { state: "sent" },
					},
					{
						kind: "discord",
						status: "recorded",
						recordedAt: "t",
						delivery: { state: "queued" },
					},
				],
			}),
			"just now",
		);
		expect(md).toContain("**webhook** · sent");
		expect(md).toContain("**discord** · queued");
	});

	test("duplicate action lines are ordinaled — BOTH members, not one bare", () => {
		const md = runToMarkdown(
			makeRun({
				actions: [
					{ kind: "block", status: "executed", recordedAt: "t1" },
					{ kind: "comment", status: "executed", recordedAt: "t2" },
					{ kind: "block", status: "executed", recordedAt: "t3" },
				],
			}),
			"just now",
		);
		expect(md).toContain("**block** · executed (1)");
		expect(md).toContain("**block** · executed (2)");
		// the lone comment is NOT numbered
		expect(md).toContain("**comment** · executed\n");
		// never a bare block line next to a numbered one
		expect(md).not.toMatch(/\*\*block\*\* · executed\n/);
	});

	test("no url or secret ever appears — even with a webhook action present", () => {
		// A run that WOULD leak if the serializer read raw rows: the delivery
		// carries only a state + class, never the destination the guard stripped.
		const md = runToMarkdown(
			makeRun({
				steps: [step({ ruleRef: "account-age@1", status: "fail" })],
				actions: [
					{
						kind: "webhook",
						status: "recorded",
						recordedAt: "t",
						delivery: { state: "failed", reason: "blocked-destination" },
					},
					{ kind: "block", status: "executed", recordedAt: "t" },
				],
			}),
			"just now",
		);
		expect(md).not.toContain("http://");
		expect(md).not.toContain("https://");
		expect(md).not.toContain("discord.com");
		expect(md).not.toMatch(/\bwebhook\.site\b/);
	});
});
