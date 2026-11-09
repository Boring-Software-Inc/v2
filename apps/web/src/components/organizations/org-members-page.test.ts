import { describe, expect, test } from "bun:test";
import {
	inviteExpiryLabel,
	shouldDeleteInsteadOfLeave,
} from "#/components/organizations/org-members-page";

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

describe("leaving an org", () => {
	test("the only admin must delete the org instead of leaving it ownerless", () => {
		expect(shouldDeleteInsteadOfLeave("admin", [{ role: "admin" }])).toBe(true);
		expect(
			shouldDeleteInsteadOfLeave("admin", [
				{ role: "admin" },
				{ role: "member" },
			]),
		).toBe(true);
	});

	test("members and admins with another admin can leave", () => {
		expect(shouldDeleteInsteadOfLeave("member", [{ role: "admin" }])).toBe(
			false,
		);
		expect(
			shouldDeleteInsteadOfLeave("admin", [
				{ role: "admin" },
				{ role: "admin" },
			]),
		).toBe(false);
	});
});
