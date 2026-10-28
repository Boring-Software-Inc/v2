import { z } from "zod";
import { verdictSchema } from "./runs.ts";
import { HELD_VERDICTS } from "./verdict-join.ts";

/**
 * The outbound webhook payload — a STABLE, VERSIONED public contract consumers
 * build against. `version` is the compatibility anchor: additive fields are
 * safe under v1; a breaking shape change bumps to v2 and both ship until
 * consumers migrate. Carries no secret — the destination URL is config, never
 * echoed into the body.
 *
 * SECURITY NOTE: the destination URL that receives this is masked in the UI
 * (`.meta({ secret: true })`) but is NOT encrypted at rest. At-rest encryption
 * for stored secrets (this URL, OAuth tokens) is a tracked, separate gap —
 * see docs/SECURITY.md. Display masking is display only.
 */

export const webhookFiredRuleSchema = z.object({
	/** Bare rule id, e.g. "account-age". */
	ruleId: z.string(),
	/** Its one-liner outcome, the same contributor-facing text the comment uses. */
	summary: z.string(),
});

export const webhookPayloadSchema = z.object({
	version: z.literal(1),
	verdict: verdictSchema,
	org: z.string(),
	repo: z.string(),
	changeRequest: z.object({
		number: z.number().int(),
		title: z.string(),
		author: z.string(),
	}),
	/** The rules that fired on this run (empty on a clean pass). */
	firedRules: z.array(webhookFiredRuleSchema),
	/** Deep link to the tripwire run page. */
	runUrl: z.string(),
	/** ISO 8601, stamped when the run completed. */
	timestamp: z.string(),
});
export type WebhookPayload = z.infer<typeof webhookPayloadSchema>;

function discordHeadline(payload: WebhookPayload): string {
	const subject = `${payload.repo} #${payload.changeRequest.number}`;
	if (payload.verdict === "pass") {
		return `${subject} passed Tripwire's checks.`;
	}
	if (payload.verdict === "block") {
		return `Tripwire blocked ${subject}.`;
	}
	if (payload.verdict === "changes_required") {
		return `Tripwire asked for changes on ${subject}.`;
	}
	if (payload.verdict === "close") {
		return `Tripwire closed ${subject}.`;
	}
	return `${subject} needs human review.`;
}

/**
 * The Discord message shape (`content` + one embed). Its OWN pure formatter —
 * it does not reuse the GitHub comment renderer (that output is locked and
 * markdown-shaped for GitHub). String in, Discord JSON out, so the worker and
 * any preview share it.
 */
export const discordMessageSchema = z.object({
	content: z.string(),
	embeds: z.array(
		z.object({
			title: z.string(),
			url: z.string(),
			description: z.string(),
			color: z.number().int(),
		}),
	),
});
export type DiscordMessage = z.infer<typeof discordMessageSchema>;

export function formatDiscordMessage(payload: WebhookPayload): DiscordMessage {
	const held = HELD_VERDICTS.some((verdict) => verdict === payload.verdict);
	const color =
		payload.verdict === "pass" ? 0x22c55e : held ? 0xef4444 : 0xf59e0b;
	const reasons =
		payload.firedRules.length > 0
			? payload.firedRules.map((rule) => `- ${rule.summary}`).join("\n")
			: held
				? "Details are on the Tripwire run page."
				: "No rule blocked this change request.";
	return {
		content: discordHeadline(payload),
		embeds: [
			{
				title: `#${payload.changeRequest.number} ${payload.changeRequest.title}`,
				url: payload.runUrl,
				description: reasons,
				color,
			},
		],
	};
}
