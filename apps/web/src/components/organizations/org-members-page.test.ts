import { describe, expect, test } from "bun:test";
import { inviteExpiryLabel } from "#/components/organizations/org-members-page";

const NOW = Date.parse("2026-10-25T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

describe("inviteExpiryLabel", () => {
	test("counts whole days left, rounding up", () => {
		expect(inviteExpiryLabel(new Date(NOW + 6 * DAY), NOW)).toBe(
			"Expires in 6 days",
		);
		expect(inviteExpiryLabel(new Date(NOW + 5 * DAY + 1), NOW)).toBe(
			"Expires in 6 days",
		);
	});

	test("the last day reads as today", () => {
		expect(inviteExpiryLabel(new Date(NOW + 2 * 60 * 60 * 1000), NOW)).toBe(
			"Expires today",
		);
	});

	test("a past date is expired", () => {
		expect(inviteExpiryLabel(new Date(NOW - 1), NOW)).toBe("Expired");
		expect(inviteExpiryLabel(new Date(NOW).toISOString(), NOW)).toBe("Expired");
	});
});
