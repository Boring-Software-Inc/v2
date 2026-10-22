import { describe, expect, test } from "bun:test";
import { toFullRunView, toPublicRunView } from "#/lib/run-access";
import {
	APP_OG_IMAGE,
	dropUnsupportedWords,
	fitOgTitle,
	normalizeOgTitle,
	parseRunOgPath,
	runOgCard,
	runOgHash,
	runOgImage,
} from "#/lib/run-og";
import type { RunView } from "#/lib/runs.functions";

const memberView: RunView = {
	id: "run-1",
	repoFullName: "acme/pub",
	subjectNumber: 91,
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
	canRerun: true,
	stepsHidden: false,
	steps: [
		{
			id: "step-1",
			nodeId: "default@1:account-age-1",
			nodeKind: "rule",
			ruleRef: "account-age@1",
			ruleName: "Account age",
			status: "failed",
			evidence: null,
			output: null,
			durationMs: 3,
			startedAt: "2026-07-11T00:00:00.000Z",
			publicEvidence: { accountAgeDays: 1 },
			summary: "this account is 1 days old",
		},
	],
	actions: [],
	redactionLevel: 0,
	event: {
		kind: "change-request.opened",
		actor: "g-r-i-m",
		title: "fix: resolve auth token expiry",
		headSha: "abc1234",
		at: "2026-07-11T00:00:00.000Z",
	},
	workflows: [],
	reviews: [],
	previousRun: null,
	nextRun: null,
};

const publicView = toPublicRunView(memberView);

describe("normalizeOgTitle", () => {
	test("collapses whitespace and newlines onto one line", () => {
		expect(normalizeOgTitle("  fix:\n resolve\t\tauth  ")).toBe(
			"fix: resolve auth",
		);
	});

	test("caps very long titles without splitting a grapheme", () => {
		const title = `${"a".repeat(89)}👨‍👩‍👧tail`;
		const normalized = normalizeOgTitle(title);
		expect(normalized.endsWith("👨‍👩‍👧")).toBe(true);
		expect(normalized).not.toContain("tail");
	});
});

describe("fitOgTitle", () => {
	const measure = (text: string) => text.length * 24;

	test("a title that fits renders without the fade", async () => {
		expect(await fitOgTitle("fix: short", 864, measure)).toEqual({
			text: "fix: short",
			fade: false,
		});
	});

	test("a title wider than the line fades at the right edge", async () => {
		const fitted = await fitOgTitle("x".repeat(60), 864, measure);
		expect(fitted.fade).toBe(true);
		expect(fitted.text).toBe("x".repeat(60));
	});

	test("an exact fit does not fade", async () => {
		expect((await fitOgTitle("x".repeat(36), 864, measure)).fade).toBe(false);
	});
});

describe("dropUnsupportedWords", () => {
	test("drops whole words that hold a glyph the font cannot draw", () => {
		expect(
			dropUnsupportedWords("fix: 日本語 Русский перевод", ["日本語"]),
		).toBe("fix: Русский перевод");
	});

	test("keeps the title when nothing is unsupported", () => {
		expect(dropUnsupportedWords("✨ feat: ship", [])).toBe("✨ feat: ship");
	});
});

describe("runOgCard", () => {
	test("a public run carries repo, number, title, and author only", () => {
		expect(runOgCard(publicView)).toEqual({
			repo: "acme/pub",
			number: 91,
			title: "fix: resolve auth token expiry",
			author: "g-r-i-m",
			avatarUrl: "https://github.com/g-r-i-m.png?size=80",
		});
	});

	test("an unknown or private run falls back to the app image", () => {
		expect(runOgCard(null)).toBeNull();
		expect(runOgImage("run-1", null)).toEqual(APP_OG_IMAGE);
	});

	test("a member's full view never feeds the run image", () => {
		expect(runOgCard(toFullRunView(memberView))).toBeNull();
		expect(runOgImage("run-1", memberView)).toEqual(APP_OG_IMAGE);
	});

	test("a run with no title falls back to the app image", () => {
		const untitled = {
			...publicView,
			event: publicView.event && { ...publicView.event, title: "  " },
		};
		expect(runOgCard(untitled)).toBeNull();
	});

	test("no avatar url off github or for an odd login", () => {
		expect(
			runOgCard({ ...publicView, forge: "opengit" })?.avatarUrl,
		).toBeNull();
		const odd = {
			...publicView,
			event: publicView.event && { ...publicView.event, actor: "../x" },
		};
		expect(runOgCard(odd)?.avatarUrl).toBeNull();
	});

	test("the verdict, rule names, and reasons never reach the card", () => {
		const text = JSON.stringify(runOgCard(publicView));
		expect(text).not.toContain("block");
		expect(text).not.toContain("Account age");
		expect(text).not.toContain("account-age");
		expect(text).not.toContain("days old");
	});
});

describe("runOgImage", () => {
	test("points a public run at a content-hashed image", () => {
		const card = runOgCard(publicView);
		if (!card) {
			throw new Error("expected a card");
		}
		expect(runOgImage("run-1", publicView)).toEqual({
			path: `/og/runs/run-1/${runOgHash(card)}`,
			width: 1200,
			height: 630,
		});
	});

	test("the hash changes when the title changes", () => {
		const card = runOgCard(publicView);
		if (!card) {
			throw new Error("expected a card");
		}
		expect(runOgHash(card)).not.toBe(runOgHash({ ...card, title: "other" }));
		expect(runOgHash(card)).toMatch(/^[a-z0-9]{14}$/);
	});
});

describe("parseRunOgPath", () => {
	test("reads the run id and hash", () => {
		expect(parseRunOgPath("/og/runs/run-1/abc")).toEqual({
			runId: "run-1",
			hash: "abc",
		});
	});

	test("ignores other paths and malformed escapes", () => {
		expect(parseRunOgPath("/runs/run-1")).toBeNull();
		expect(parseRunOgPath("/og/runs/run-1/a/b")).toBeNull();
		expect(parseRunOgPath("/og/runs/%E0/a")).toBeNull();
	});
});
