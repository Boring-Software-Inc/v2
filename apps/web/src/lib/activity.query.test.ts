import { expect, test } from "bun:test";
import { belongsTo } from "#/lib/activity.query";

test("live feed updates match forge as well as repository name", () => {
	const repo = { forge: "github" as const, fullName: "same/repo" };
	expect(
		belongsTo({ forge: "github", repo: { fullName: "same/repo" } }, repo),
	).toBe(true);
	expect(
		belongsTo({ forge: "opengit", repo: { fullName: "same/repo" } }, repo),
	).toBe(false);
	expect(
		belongsTo({ forge: "github", repo: { fullName: "other/repo" } }, repo),
	).toBe(false);
	expect(belongsTo({ forge: "github" }, repo)).toBe(false);
});
