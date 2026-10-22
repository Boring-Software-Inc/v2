import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * §6 display-internalization leak guard. The `@version` tag is engine identity,
 * not product copy: contributor-facing surfaces must render rule names through
 * `ruleDisplayName` / `ruleIdOf` (contracts), never format or split a ref
 * themselves. This asserts the surfaces that used to print or split `id@version`
 * no longer do so.
 */

const componentsDir = join(import.meta.dir, "..", "components");
const SURFACES = [
	"rules/rule-card.tsx",
	"runs/branch-card.tsx",
	"runs/run-chain.tsx",
	"runs/rule-evidence.tsx",
] as const;

describe("rule @version tag is internalized (§6 display)", () => {
	for (const rel of SURFACES) {
		const src = readFileSync(join(componentsDir, rel), "utf8");

		test(`${rel} splits no refs itself (delegates to the contracts util)`, () => {
			expect(src).not.toContain('.split("@")');
			expect(src).not.toContain('startsWith("ai-review@")');
		});

		test(`${rel} renders no literal id@version tag`, () => {
			// the removed `{rule.ruleId}@{rule.version}` chip and any `@{…version}`
			expect(src).not.toMatch(/\}@\{/);
			expect(src).not.toMatch(/@\{[^}]*version/i);
		});
	}

	test("the run chain routes rule names through ruleDisplayName", () => {
		const src = readFileSync(join(import.meta.dir, "run-chain.ts"), "utf8");
		expect(src).toContain("ruleDisplayName");
	});
});
