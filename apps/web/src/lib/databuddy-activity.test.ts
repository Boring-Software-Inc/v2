import { describe, expect, test } from "bun:test";
import { summarizeProfile, summarizeSessions } from "./databuddy-activity.ts";

describe("summarizeProfile", () => {
	test("reads the first profile row and its known fields", () => {
		expect(
			summarizeProfile([
				{
					first_visit: "2026-10-11 09:40:00",
					last_visit: "2026-10-24 08:12:00",
					total_sessions: "14",
					total_pageviews: 212,
					country: "NG",
					device_type: "desktop",
					browser_name: "Chrome",
					os_name: "macOS",
				},
			]),
		).toEqual({
			firstSeen: "2026-10-11 09:40:00",
			lastSeen: "2026-10-24 08:12:00",
			sessions: 14,
			pageviews: 212,
			country: "NG",
			device: "desktop",
			browser: "Chrome",
			os: "macOS",
		});
	});

	test("no rows is no profile", () => {
		expect(summarizeProfile([])).toBeNull();
	});

	test("unknown shapes become empty fields, never a crash", () => {
		expect(summarizeProfile([{ weird: { nested: true } }])).toEqual({
			firstSeen: null,
			lastSeen: null,
			sessions: null,
			pageviews: null,
			country: null,
			device: null,
			browser: null,
			os: null,
		});
	});
});

describe("summarizeSessions", () => {
	test("maps rows and caps the list", () => {
		const rows = Array.from({ length: 12 }, (_, i) => ({
			session_id: `s${i}`,
			session_start: "2026-10-24 08:12:00",
			duration: 61,
			page_views: 3,
			path: "/lumen-labs/home",
		}));
		const sessions = summarizeSessions(rows);
		expect(sessions).toHaveLength(10);
		expect(sessions[0]).toEqual({
			id: "s0",
			startedAt: "2026-10-24 08:12:00",
			durationSeconds: 61,
			pageviews: 3,
			entryPage: "/lumen-labs/home",
			country: null,
			browser: null,
			device: null,
		});
	});

	test("a row without an id still gets a stable key", () => {
		expect(summarizeSessions([{}])[0]?.id).toBe("session-0");
	});
});
