import { describe, expect, test } from "bun:test";
import {
	activeSectionAt,
	changeRequestLabel,
	contributorVerdictLabel,
	flagSourceLabel,
	flagSyncLabel,
	formatWait,
	historySentence,
	minutesLeft,
	moderationDecisionLabel,
	pickFromPage,
	sheetPosition,
} from "./admin-user-sheet";

describe("sheetPosition", () => {
	const ids = ["a", "b", "c"];

	test("middle of a page steps to neighbours", () => {
		expect(
			sheetPosition({ ids, offset: 50, pageSize: 50, total: 212, userId: "b" }),
		).toEqual({
			label: "User 52 of 212",
			prev: { kind: "user", id: "a" },
			next: { kind: "user", id: "c" },
		});
	});

	test("page edges step across pages", () => {
		const first = sheetPosition({
			ids,
			offset: 50,
			pageSize: 50,
			total: 212,
			userId: "a",
		});
		expect(first.prev).toEqual({ kind: "page", offset: 0, pick: "last" });
		const last = sheetPosition({
			ids,
			offset: 50,
			pageSize: 50,
			total: 212,
			userId: "c",
		});
		expect(last.next).toEqual({ kind: "page", offset: 100, pick: "first" });
	});

	test("the very first and last users have no step out", () => {
		expect(
			sheetPosition({ ids, offset: 0, pageSize: 50, total: 3, userId: "a" })
				.prev,
		).toBeNull();
		expect(
			sheetPosition({ ids, offset: 0, pageSize: 50, total: 3, userId: "c" })
				.next,
		).toBeNull();
	});

	test("a deep link outside the page has no count and no steps", () => {
		expect(
			sheetPosition({ ids, offset: 0, pageSize: 50, total: 3, userId: "z" }),
		).toEqual({ label: "User", prev: null, next: null });
	});

	test("pickFromPage picks the edge", () => {
		expect(pickFromPage(ids, "first")).toBe("a");
		expect(pickFromPage(ids, "last")).toBe("c");
		expect(pickFromPage([], "last")).toBeNull();
	});
});

describe("formatWait", () => {
	test("formats hours and minutes", () => {
		expect(formatWait((4 * 60 + 22) * 60_000)).toBe("4 hr 22 min");
		expect(formatWait(2 * 3_600_000)).toBe("2 hr");
		expect(formatWait(12 * 60_000)).toBe("12 min");
		expect(formatWait(30_000)).toBe("Under 1 min");
		expect(formatWait(26 * 3_600_000)).toBe("1 d 2 hr");
		expect(formatWait(-5)).toBe("Under 1 min");
	});
});

describe("historySentence", () => {
	test("covers flag in, on, off and reset", () => {
		expect(
			historySentence({
				actorName: "grim",
				flagKey: "show-sidebar",
				from: "default",
				to: "on",
			}),
		).toBe("grim flagged them in to show-sidebar");
		expect(
			historySentence({
				actorName: "grim",
				flagKey: "show-sidebar",
				from: "on",
				to: "off",
			}),
		).toBe("grim turned show-sidebar off");
		expect(
			historySentence({
				actorName: "grim",
				flagKey: "show-sidebar",
				from: "off",
				to: "on",
			}),
		).toBe("grim turned show-sidebar on");
		expect(
			historySentence({
				actorName: null,
				flagKey: "access-gate",
				from: "on",
				to: "default",
			}),
		).toBe("A deleted staff member reset access-gate to default");
	});
});

describe("flag labels", () => {
	test("source labels", () => {
		expect(flagSourceLabel("rule")).toBe("Their rule");
		expect(flagSourceLabel("default")).toBe("Default");
		expect(
			flagSourceLabel("rule", { choice: "off", syncStatus: "synced" }),
		).toBe("Tripwire override");
		expect(
			flagSourceLabel("rule", { choice: "off", syncStatus: "pending" }),
		).toBe("Their rule");
	});

	test("sync labels", () => {
		expect(
			flagSyncLabel({ connected: false, inDatabuddy: null, syncStatus: null }),
		).toEqual({ tone: "quiet", label: "Not connected" });
		expect(
			flagSyncLabel({
				connected: true,
				inDatabuddy: true,
				syncStatus: "pending",
			}),
		).toEqual({ tone: "warn", label: "Pending" });
		expect(
			flagSyncLabel({
				connected: true,
				inDatabuddy: true,
				syncStatus: "failed",
			}),
		).toEqual({ tone: "fail", label: "Failed" });
		expect(
			flagSyncLabel({ connected: true, inDatabuddy: false, syncStatus: null }),
		).toEqual({ tone: "quiet", label: "Not in Databuddy" });
		expect(
			flagSyncLabel({ connected: true, inDatabuddy: true, syncStatus: null }),
		).toEqual({ tone: "ok", label: "Synced" });
	});
});

describe("moderation labels", () => {
	test("decisions and verdicts", () => {
		expect(moderationDecisionLabel("denied")).toBe("Blocked");
		expect(moderationDecisionLabel("approved")).toBe("Approved");
		expect(contributorVerdictLabel("block")).toEqual({
			label: "Blocked",
			tone: "fail",
		});
		expect(contributorVerdictLabel("needs_review").label).toBe("Human review");
		expect(changeRequestLabel("openfield/web", 88)).toBe("openfield/web #88");
		expect(changeRequestLabel("openfield/web", null)).toBe("openfield/web");
	});
});

describe("minutesLeft", () => {
	test("rounds up and never goes negative", () => {
		const now = Date.parse("2026-10-24T10:00:00Z");
		expect(minutesLeft("2026-10-24T10:58:00Z", now)).toBe(58);
		expect(minutesLeft("2026-10-24T10:00:30Z", now)).toBe(1);
		expect(minutesLeft("2026-10-24T09:00:00Z", now)).toBe(0);
	});
});

describe("activeSectionAt", () => {
	const tops = [
		{ id: "access", top: -400 },
		{ id: "flags", top: 120 },
		{ id: "account", top: 900 },
	] as const;

	test("the last section whose top passed the line is active", () => {
		expect(activeSectionAt(tops, 140)).toBe("flags");
		expect(activeSectionAt(tops, 100)).toBe("access");
	});

	test("nothing passed yet means the first section", () => {
		expect(activeSectionAt([{ id: "access", top: 300 }], 100)).toBe("access");
	});
});
