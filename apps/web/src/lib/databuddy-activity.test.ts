import { describe, expect, test } from "bun:test";
import {
	databuddyProfileRowSchema,
	databuddySessionRowSchema,
} from "@tripwire/contracts";
import { summarizeProfile, summarizeSessions } from "./databuddy-activity.ts";

describe("summarizeProfile", () => {
	test("reads the profile row from Databuddy", () => {
		const row = databuddyProfileRowSchema.parse({
			first_visit: "2026-10-11 09:40:00",
			last_visit: "2026-10-24 08:12:00",
			total_sessions: "14",
			total_pageviews: 212,
			country: "NG",
			device_type: "desktop",
			browser_name: "Chrome",
			os_name: "macOS",
		});
		expect(summarizeProfile(row)).toEqual({
			firstSeen: "2026-10-11T09:40:00Z",
			lastSeen: "2026-10-24T08:12:00Z",
			sessions: 14,
			pageviews: 212,
			country: "NG",
			device: "desktop",
			browser: "Chrome",
			os: "macOS",
		});
	});

	test("no row is no profile", () => {
		expect(summarizeProfile(null)).toBeNull();
	});

	test("fields of the wrong shape become empty, never a crash", () => {
		const row = databuddyProfileRowSchema.parse({
			total_sessions: { nested: true },
			country: ["NG"],
		});
		expect(summarizeProfile(row)).toMatchObject({
			sessions: null,
			country: null,
		});
	});
});

describe("summarizeSessions", () => {
	test("maps session rows", () => {
		const row = databuddySessionRowSchema.parse({
			session_id: "s1",
			session_start: "2026-10-24 08:12:00",
			duration: 61,
			page_views: "3",
			path: "/lumen-labs/home",
		});
		expect(summarizeSessions([row])).toEqual([
			{
				id: "s1",
				startedAt: "2026-10-24T08:12:00Z",
				durationSeconds: 61,
				pageviews: 3,
				entryPage: "/lumen-labs/home",
				country: null,
				browser: null,
				device: null,
			},
		]);
	});

	test("a row without an id still gets a stable key", () => {
		const row = databuddySessionRowSchema.parse({});
		expect(summarizeSessions([row])[0]?.id).toBe("session-0");
	});
});
