import { cryptoAddressConfigSchema } from "@tripwire/contracts";
import {
	empty,
	evaluateSignalRule,
	type ScanMatch,
	type ScanPattern,
} from "@tripwire/sdk";
import { z } from "zod";
import { readContextSignal, rule, signals } from "./context-forge.ts";
import { defineRule } from "./define.ts";

/**
 * Deliberately conservative patterns — false positives block real
 * contributors, so each pattern anchors on the address format, not keywords.
 * Live data, supplied to the scan at evaluation time; serializing patterns
 * for stored custom rules is a Phase 4 item.
 */
const PATTERNS: readonly ScanPattern[] = [
	{ kind: "eth", pattern: /\b0x[a-fA-F0-9]{40}\b/g },
	{
		kind: "btc",
		pattern: /\b(bc1[a-z0-9]{25,62}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})\b/g,
	},
	{ kind: "sol", pattern: /\b[1-9A-HJ-NP-Za-km-z]{43,44}\b/g },
];

/**
 * crypto-address@1 — no cryptocurrency addresses in the title, comment body,
 * or diff. Airdrop spam dies here. Evidence: every match and where it was.
 * Authored as an SDK signal rule: pr.textByLocation scanned for the address
 * patterns, compared with empty(). The verdict and the match evidence come
 * from ONE evaluation: passed from empty(), matches from resolvedValue.
 */
export const cryptoAddress = defineRule({
	id: "crypto-address",
	version: 1,
	configSchema: cryptoAddressConfigSchema,
	resultSchema: z.object({
		matches: z.array(
			z.object({ kind: z.string(), value: z.string(), location: z.string() }),
		),
	}),
	async evaluate(ctx) {
		const read = await readContextSignal("pr.textByLocation", ctx);
		if (!read.ok) {
			return { status: "skipped", reason: read.reason };
		}
		const requirement = rule("crypto address", {
			when: signals.pr.textByLocation.scan(PATTERNS),
			comparison: empty(),
			severity: "high",
		});
		const { passed, resolvedValue } = evaluateSignalRule(requirement, {
			value: read.value,
			now: ctx.now,
		});
		// The scan transform yields the match list by construction.
		const matches = resolvedValue as readonly ScanMatch[];
		return {
			status: "evaluated",
			passed,
			evidence: { matches: [...matches] },
		};
	},
	// The matches are the contributor's own content — all public.
	publicEvidence: (e) => ({ matches: e.matches }),
	summarize: (e) => {
		if (e.matches.length === 0) {
			return "No crypto wallet addresses found.";
		}
		const locations = [...new Set(e.matches.map((m) => m.location))].map(
			(location) =>
				location === "title" || location === "comment"
					? `the ${location}`
					: location,
		);
		const where =
			locations.length === 0
				? ""
				: locations.length === 1
					? ` to ${locations[0]}`
					: ` to ${locations.slice(0, -1).join(", ")} and ${locations.at(-1)}`;
		return `It adds ${e.matches.length} crypto wallet ${e.matches.length === 1 ? "address" : "addresses"}${where}.`;
	},
	// Fixable in the change itself — remove the address(es).
	remedy: "revise",
	fixHint: (e) =>
		e.matches.length === 1 ? "Remove the address." : "Remove the addresses.",
});
