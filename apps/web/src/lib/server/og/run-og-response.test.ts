import { describe, expect, test } from "bun:test";
import { toPublicRunView } from "#/lib/run-access";
import { type OgFormat, type RunOgCard, runOgImage } from "#/lib/run-og";
import type { RunView } from "#/lib/runs.functions";
import { runOgResponse } from "#/lib/server/og/run-og-response";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const MP4 = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70]);

const memberView: RunView = {
	id: "run-1",
	repoFullName: "acme/pub",
	subjectNumber: 88,
	subjectKind: "change-request",
	headSha: "abc1234",
	status: "completed",
	verdict: "block",
	createdAt: "2026-07-11T00:00:00.000Z",
	completedAt: "2026-07-11T00:00:01.000Z",
	snapshot: null,
	access: "full",
	rerun: false,
	rerunBy: null,
	orgSlug: "acme",
	repoName: "pub",
	forge: "github",
	subjectUrl: null,
	canRerun: false,
	stepsHidden: false,
	steps: [
		{
			id: "step-1",
			nodeId: "default@1:crypto-guard-1",
			nodeKind: "rule",
			ruleRef: "crypto-guard@1",
			ruleName: "Crypto guard",
			status: "failed",
			evidence: null,
			output: null,
			durationMs: 3,
			startedAt: "2026-07-11T00:00:00.000Z",
			publicEvidence: null,
			summary: "mentions a wallet airdrop",
		},
	],
	actions: [
		{
			kind: "block",
			status: "executed",
			recordedAt: "2026-07-11T00:00:01.000Z",
			url: null,
		},
	],
	redactionLevel: 0,
	event: {
		kind: "change-request.opened",
		actor: "g-r-i-m",
		title: "[tripwire live test] claim airdrop 0x0000",
		headSha: "abc1234",
		at: "2026-07-11T00:00:00.000Z",
	},
	workflows: [{ id: "default@1", name: "Rules", outcome: "block" }],
	reviews: [],
	previousRun: null,
	nextRun: null,
	backfill: false,
	aiReviewNotRun: false,
};

const publicView = toPublicRunView(memberView);
const currentHash =
	runOgImage("run-1", publicView).path.split("/").at(-1) ?? "";

function harness(view: RunView | null) {
	const rendered: RunOgCard[] = [];
	const formats: OgFormat[] = [];
	return {
		rendered,
		formats,
		deps: {
			loadView: async () => view,
			render: async (card: RunOgCard, format: OgFormat) => {
				rendered.push(card);
				formats.push(format);
				return format === "mp4" ? MP4 : PNG;
			},
		},
	};
}

describe("runOgResponse", () => {
	test("a public run renders an immutable png", async () => {
		const { deps, rendered } = harness(publicView);
		const response = await runOgResponse("run-1", currentHash, deps);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("image/png");
		expect(response.headers.get("cache-control")).toBe(
			"public, max-age=31536000, immutable",
		);
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);
		expect(rendered).toHaveLength(1);
	});

	test("the render input never holds the verdict, rule names, or reasons", async () => {
		const { deps, rendered } = harness(publicView);
		await runOgResponse("run-1", currentHash, deps);
		const input = JSON.stringify(rendered);
		for (const leak of [
			"block",
			"Crypto guard",
			"crypto-guard",
			"mentions a wallet",
			"Rules",
		]) {
			expect(input).not.toContain(leak);
		}
	});

	test("a private or unknown run redirects to the app image without rendering", async () => {
		const { deps, rendered } = harness(null);
		const response = await runOgResponse("run-1", currentHash, deps);
		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe("/og.png");
		expect(response.headers.get("cache-control")).toBe("public, max-age=300");
		expect(rendered).toHaveLength(0);
	});

	test("a member's full view is never rendered", async () => {
		const { deps, rendered } = harness(memberView);
		const response = await runOgResponse("run-1", currentHash, deps);
		expect(response.headers.get("location")).toBe("/og.png");
		expect(rendered).toHaveLength(0);
	});

	test("a load failure falls back to the app image", async () => {
		const response = await runOgResponse("run-1", currentHash, {
			loadView: async () => {
				throw new Error("invalid uuid");
			},
			render: async () => PNG,
		});
		expect(response.headers.get("location")).toBe("/og.png");
	});

	test("a stale hash redirects to the current image", async () => {
		const { deps, rendered } = harness(publicView);
		const response = await runOgResponse("run-1", "0000000", deps);
		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe(
			`/og/runs/run-1/${currentHash}`,
		);
		expect(rendered).toHaveLength(0);
	});

	test("a malformed hash never reaches the loader", async () => {
		const response = await runOgResponse("run-1", "x.svg", {
			loadView: async () => {
				throw new Error("must not load");
			},
			render: async () => PNG,
		});
		expect(response.headers.get("location")).toBe("/og.png");
	});

	test("a render failure falls back to the app image", async () => {
		const response = await runOgResponse("run-1", currentHash, {
			loadView: async () => publicView,
			render: async () => {
				throw new Error("resvg failed");
			},
		});
		expect(response.headers.get("location")).toBe("/og.png");
	});

	test("a public run's video renders an immutable mp4", async () => {
		const { deps, formats } = harness(publicView);
		const response = await runOgResponse("run-1", currentHash, deps, "mp4");
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("video/mp4");
		expect(response.headers.get("cache-control")).toBe(
			"public, max-age=31536000, immutable",
		);
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(MP4);
		expect(formats).toEqual(["mp4"]);
	});

	test("a private run's video redirects to the app video", async () => {
		const { deps, rendered } = harness(null);
		const response = await runOgResponse("run-1", currentHash, deps, "mp4");
		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe("/og.mp4");
		expect(rendered).toHaveLength(0);
	});

	test("a stale video hash redirects to the current video", async () => {
		const { deps } = harness(publicView);
		const response = await runOgResponse("run-1", "0000000", deps, "mp4");
		expect(response.headers.get("location")).toBe(
			`/og/runs/run-1/${currentHash}.mp4`,
		);
	});

	test("a video render failure falls back to the app video", async () => {
		const response = await runOgResponse(
			"run-1",
			currentHash,
			{
				loadView: async () => publicView,
				render: async () => {
					throw new Error("encoder failed");
				},
			},
			"mp4",
		);
		expect(response.headers.get("location")).toBe("/og.mp4");
	});
});
