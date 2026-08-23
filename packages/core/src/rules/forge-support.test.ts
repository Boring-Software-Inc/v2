import { describe, expect, test } from "bun:test";
import {
	FORGE_CATALOG,
	RULE_CATALOG,
	ruleForgeBlockReason,
	ruleSupportsForge,
} from "@tripwire/contracts";

/**
 * The forge-capability audit, pinned.
 *
 * Every built-in rule was checked against what GitLab actually returns for a
 * contributor who is NOT the calling user — the distinction that matters, since
 * a self-lookup makes the api look complete. Verified live against gitlab.com on
 * 2026-08-16 by diffing `GET /users/:id` for self vs another account:
 *
 *   keys present for SELF but absent for OTHER: ["created_at"]
 *
 * That single missing field is the entire gap. Everything else a rule reads —
 * bio, merge counts, membership, the diff — comes back real.
 *
 *   account-age@1      createdAt                 ✗ BLOCKED on gitlab
 *   ai-review@2        createdAt (soft)          ~ degrades, says so in prompt
 *   min-merged-prs@2   mergedInRepo/Elsewhere    ✓ live: 100 for a real author
 *   pr-rate-limit@1    recentChangeRequestTimes  ✓ real query, 7-day window
 *   profile-readme@1   profileText (bio)         ✓ bio present for other users
 *   crypto-address@1   diff                      ✓ live: 15 files on a real MR
 *   honeypot@1         diff                      ✓
 *   max-files-changed@1 diff                     ✓
 *   english-only@1     title/body from webhook   ✓ no forge read at all
 *
 * These tests are the guard rail, not the audit itself: they fail loudly if the
 * declared support drifts from that finding, or if a forge is added to the
 * catalog without anyone re-checking which rules it can actually feed.
 */

/**
 * The audit's conclusion, by rule id. Update ONLY alongside a live re-check.
 *
 * A Map, not a dictionary: most rules have no entry, so a lookup can miss by
 * design, and a Map says that in its type instead of an open index signature
 * that would accept any string as a key.
 */
const AUDITED_BLOCKS = new Map<string, readonly string[]>(
	Object.entries({
		// GitLab exposes `created_at` only to the account itself or an admin;
		// open-git exposes no users endpoint at all.
		"account-age": ["gitlab", "opengit"],
		// open-git's API is actions-only — no files/diff, no commits, no contents,
		// no users — so every rule that reads more than the webhook payload is inert
		// there. Verified against its openapi.json, which has 8 paths and no reads.
		"min-merged-prs": ["opengit"],
		"pr-rate-limit": ["opengit"],
		"profile-readme": ["opengit"],
		"crypto-address": ["opengit"],
		honeypot: ["opengit"],
		"max-files-changed": ["opengit"],
		"ai-review": ["opengit"],
	}),
);

describe("rule forge support", () => {
	test("every rule's declared support matches the audit", () => {
		for (const entry of RULE_CATALOG) {
			const declared = (entry as { forges?: readonly string[] }).forges;
			const blocked = AUDITED_BLOCKS.get(entry.ruleId);
			if (!blocked) {
				expect(
					declared,
					`${entry.ruleId} declares a forge list but the audit says it runs everywhere — re-check or update AUDITED_BLOCKS`,
				).toBeUndefined();
				continue;
			}
			const live = FORGE_CATALOG.filter((f) => f.status === "live").map(
				(f) => f.id,
			);
			expect(
				[...(declared ?? [])].sort(),
				`${entry.ruleId} should support exactly the forges NOT in AUDITED_BLOCKS`,
			).toEqual(live.filter((f) => !blocked.includes(f)).sort());
		}
	});

	test("account-age is unusable on gitlab and usable on github", () => {
		expect(ruleSupportsForge("account-age", "github")).toBe(true);
		expect(ruleSupportsForge("account-age", "gitlab")).toBe(false);
		// Plain language, no jargon — this string reaches the rules page verbatim.
		expect(ruleForgeBlockReason("account-age", "gitlab")).toBe(
			"not usable with gitlab",
		);
		expect(ruleForgeBlockReason("account-age", "github")).toBeNull();
	});

	test("payload-only rules run on every live forge", () => {
		// english-only reads the title/body off the webhook itself, so it needs no
		// reads and no forge can starve it. Everything else in the catalog depends
		// on a read surface and is declared per forge above.
		for (const ruleId of ["english-only"]) {
			for (const forge of FORGE_CATALOG.filter((f) => f.status === "live")) {
				expect(
					ruleSupportsForge(ruleId, forge.id),
					`${ruleId} should run on ${forge.id}`,
				).toBe(true);
			}
		}
	});

	test("an unknown rule id is never reported as blocked", () => {
		// Custom rules are not in the catalog; they must not inherit a block.
		expect(ruleSupportsForge("some-custom-rule", "gitlab")).toBe(true);
		expect(ruleForgeBlockReason("some-custom-rule", "gitlab")).toBeNull();
	});
});
