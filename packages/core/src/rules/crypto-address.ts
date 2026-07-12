import { cryptoAddressConfigSchema } from "@tripwire/contracts";
import { z } from "zod";
import { defineRule } from "./define.ts";

/**
 * Deliberately conservative patterns — false positives block real
 * contributors, so each pattern anchors on the address format, not keywords.
 */
const PATTERNS: { kind: string; regex: RegExp }[] = [
	{ kind: "eth", regex: /\b0x[a-fA-F0-9]{40}\b/g },
	{
		kind: "btc",
		regex: /\b(bc1[a-z0-9]{25,62}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})\b/g,
	},
	{ kind: "sol", regex: /\b[1-9A-HJ-NP-Za-km-z]{43,44}\b/g },
];

function scan(text: string, location: string) {
	const matches: { kind: string; value: string; location: string }[] = [];
	for (const { kind, regex } of PATTERNS) {
		for (const m of text.matchAll(regex)) {
			matches.push({ kind, value: m[0], location });
		}
	}
	return matches;
}

/**
 * crypto-address@1 — no cryptocurrency addresses in the title, comment body,
 * or diff. Airdrop spam dies here. Evidence: every match and where it was.
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
	evaluate(ctx) {
		const matches: { kind: string; value: string; location: string }[] = [];
		if (ctx.event.kind === "comment.created") {
			matches.push(...scan(ctx.event.comment.body, "comment"));
		}
		if ("changeRequest" in ctx.event) {
			matches.push(...scan(ctx.event.changeRequest.title, "title"));
		}
		for (const file of ctx.diff ?? []) {
			if (file.patch) {
				matches.push(...scan(file.patch, file.path));
			}
		}
		return {
			status: "evaluated",
			passed: matches.length === 0,
			evidence: { matches },
		};
	},
	// The matches are the contributor's own content — all public.
	publicEvidence: (e) => ({ matches: e.matches }),
	summarize: (e) => {
		if (e.matches.length === 0) {
			return "no crypto addresses found";
		}
		const locations = [...new Set(e.matches.map((m) => m.location))];
		const where = locations.length > 0 ? ` in ${locations.join(", ")}` : "";
		return `it adds ${e.matches.length} crypto ${e.matches.length === 1 ? "address" : "addresses"}${where}`;
	},
	// Fixable in the change itself — remove the address(es).
	remedy: "revise",
});
