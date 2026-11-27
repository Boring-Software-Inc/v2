import { expect, test } from "bun:test";
import { eventRetentionDays } from "./jobs/prune-events.ts";

test("event retention stays off unless set to at least 30 whole days", () => {
	expect(eventRetentionDays(undefined)).toBeNull();
	expect(eventRetentionDays("")).toBeNull();
	expect(eventRetentionDays("29")).toBeNull();
	expect(eventRetentionDays("30.5")).toBeNull();
	expect(eventRetentionDays("forever")).toBeNull();
	expect(eventRetentionDays("30")).toBe(30);
	expect(eventRetentionDays("90")).toBe(90);
});
