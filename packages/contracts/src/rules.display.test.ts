import { describe, expect, test } from "bun:test";
import {
	RULE_CATALOG,
	ruleChangeNote,
	ruleDisplayName,
	ruleIdOf,
} from "./rules.ts";

/**
 * §6 display internalization — `ruleDisplayName` is the single source of truth
 * for rule names on every user-facing surface, and it NEVER leaks the `@version`
 * engine tag. Covers every catalog entry plus the frozen versions (which aren't
 * in the catalog but must still resolve to a human name).
 */
describe("ruleDisplayName — single source of truth", () => {
	test("every catalog ref resolves to its human name, tag-free", () => {
		for (const entry of RULE_CATALOG) {
			const ref = `${entry.ruleId}@${entry.version}`;
			expect(ruleDisplayName(ref)).toBe(entry.name);
			expect(ruleDisplayName(ref)).not.toMatch(/@\d/);
		}
	});

	test("frozen versions map to the current name (names are version-stable)", () => {
		expect(ruleDisplayName("min-merged-prs@1")).toBe("Merged change requests");
		expect(ruleDisplayName("ai-review@1")).toBe("AI review");
	});

	test("unknown ref falls back to its bare id, never blank", () => {
		expect(ruleDisplayName("does-not-exist@3")).toBe("does-not-exist");
		expect(ruleDisplayName("bare-id")).toBe("bare-id");
	});

	test("an unknown custom ref never shows its generated id", () => {
		expect(ruleDisplayName("custom-doesnt-go-to-main-019fa6@1")).toBe(
			"Custom rule",
		);
	});

	test("ruleIdOf strips the version tag", () => {
		expect(ruleIdOf("account-age@1")).toBe("account-age");
		expect(ruleIdOf("ai-review@2")).toBe("ai-review");
		expect(ruleIdOf("bare")).toBe("bare");
	});
});

describe("ruleChangeNote — the versioning-law upgrade summary (§6 b)", () => {
	test("the two bumped rules carry a real note", () => {
		expect(ruleChangeNote("min-merged-prs@2")).toBe(
			"counts merges globally, not per-repo",
		);
		expect(ruleChangeNote("ai-review@2")).toBe("findings must quote code");
	});

	test("a note resolves by id, so a frozen ref sees the current note", () => {
		expect(ruleChangeNote("min-merged-prs@1")).toBe(
			"counts merges globally, not per-repo",
		);
	});

	test("never-bumped rules and unknowns have no note", () => {
		expect(ruleChangeNote("account-age@1")).toBeNull();
		expect(ruleChangeNote("does-not-exist@1")).toBeNull();
	});
});
