import {
	type CryptoAddressActivity,
	type CryptoAddressEvidence,
	cryptoAddressActivitySchema,
	cryptoAddressConfigSchema,
	cryptoAddressEvidenceSchema,
} from "@tripwire/contracts";
import {
	empty,
	evaluateSignalRule,
	type ScanMatch,
	type ScanPattern,
} from "@tripwire/sdk";
import { cryptoAddressCandidates, isCryptoAddress } from "@tripwire/utils";
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
function defineCryptoAddress(
	version: number,
	requireAvailablePatches: boolean,
) {
	return defineRule({
		id: "crypto-address",
		version,
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
			});
			const { passed, resolvedValue } = evaluateSignalRule(requirement, {
				value: read.value,
				now: ctx.now,
			});
			// The scan transform yields the match list by construction.
			const matches = resolvedValue as readonly ScanMatch[];
			if (
				requireAvailablePatches &&
				passed &&
				ctx.diff?.some((file) => file.patchUnavailable != null)
			) {
				return {
					status: "skipped",
					reason: "Tripwire could not read every patch in this change request.",
				};
			}
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
}

export const cryptoAddress = defineCryptoAddress(1, false);
/** @2 cannot establish a clean scan from explicitly omitted patches. */
export const cryptoAddressV2 = defineCryptoAddress(2, true);

export const cryptoAddressV3 = defineRule({
	id: "crypto-address",
	version: 3,
	configSchema: cryptoAddressConfigSchema,
	resultSchema: cryptoAddressEvidenceSchema,
	async evaluate(ctx) {
		const sources: { location: string; text: string; line?: number }[] = [];
		const event = ctx.event;
		if (event.kind === "comment.created")
			sources.push({ location: "comment", text: event.comment.body });
		if (event.kind === "issue.opened") {
			sources.push({ location: "title", text: event.issue.title });
			if (event.issue.body)
				sources.push({ location: "body", text: event.issue.body });
		}
		if ("changeRequest" in event)
			sources.push({ location: "title", text: event.changeRequest.title });
		for (const file of ctx.diff ?? []) {
			if (file.status === "removed") continue;
			let line = 0;
			let inHunk = false;
			for (const text of file.patch?.split("\n") ?? []) {
				const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
				if (hunk) {
					line = Number(hunk[1]);
					inHunk = true;
					continue;
				}
				if (!inHunk && /^(?:diff |index |--- |\+\+\+ )/.test(text)) continue;
				if (text.startsWith("+")) {
					const source: (typeof sources)[number] = {
						location: file.path,
						text: text.slice(1),
					};
					if (line > 0) source.line = line;
					sources.push(source);
					line++;
				} else if (text.startsWith(" ")) line++;
			}
		}
		const candidates = sources.flatMap((source) =>
			cryptoAddressCandidates(source.text).map((candidate) => ({
				...candidate,
				source,
			})),
		);
		const matches: CryptoAddressEvidence["matches"] = [];
		const checks = new Map<string, CryptoAddressActivity>();
		let unavailable = false;
		for (const candidate of candidates.slice(0, 100)) {
			const { kind, value, source } = candidate;
			if (!(await isCryptoAddress(kind, value))) continue;
			const key = `${kind}:${value}`;
			let activity = checks.get(key);
			if (!activity && ctx.readCryptoAddressActivity) {
				const result = cryptoAddressActivitySchema.safeParse(
					await ctx.readCryptoAddressActivity(kind, value),
				);
				if (
					result.success &&
					result.data.kind === kind &&
					result.data.value === value
				)
					activity = result.data;
				if (activity) checks.set(key, activity);
			}
			const nearby = source.text.slice(
				Math.max(0, candidate.index - 80),
				candidate.index + value.length + 80,
			);
			const paymentContext =
				/\b(?:wallet|donate|donation|airdrop)\b|\b(?:solana|ethereum|bitcoin):/i.test(
					nearby,
				);
			const confirmation =
				kind === "btc"
					? "checksum"
					: kind === "eth"
						? "address-format"
						: paymentContext
							? "payment-context"
							: activity?.status === "observed"
								? "chain-activity"
								: null;
			if (confirmation) {
				const match: CryptoAddressEvidence["matches"][number] = {
					kind,
					value,
					location: source.location,
					confirmation,
				};
				if (source.line) match.line = source.line;
				matches.push(match);
			} else if (!activity || activity.status === "unavailable")
				unavailable = true;
		}
		if (
			matches.length === 0 &&
			(unavailable ||
				candidates.length > 100 ||
				ctx.diff === null ||
				ctx.diff.some((file) => file.patchUnavailable != null))
		) {
			return {
				status: "skipped",
				reason: unavailable
					? "Tripwire could not corroborate a possible Solana address with chain activity."
					: "Tripwire could not complete the crypto address scan.",
			};
		}
		return {
			status: "evaluated",
			passed: matches.length === 0,
			evidence: { matches, checks: [...checks.values()] },
		};
	},
	publicEvidence: (evidence) => ({
		matches: evidence.matches,
		checks: evidence.checks,
	}),
	summarize: (evidence) =>
		evidence.matches.length === 0
			? "No confirmed crypto wallet addresses found."
			: `It adds ${evidence.matches.length} crypto wallet ${evidence.matches.length === 1 ? "address" : "addresses"} to ${[...new Set(evidence.matches.map((match) => match.location))].join(", ")}.`,
	remedy: "revise",
	fixHint: (evidence) =>
		evidence.matches.length === 1
			? "Remove the address."
			: "Remove the addresses.",
});
