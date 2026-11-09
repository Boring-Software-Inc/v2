import { track } from "@databuddy/sdk";
import { z } from "zod";

type Events = {
	signed_in: Record<string, never>;
	beta_approved: { count: number };
	github_app_install_started: { forge: string };
	installation_claimed: { forge: string };
	repo_activated: Record<string, never>;
	workflow_created: { from_template: boolean };
	workflow_enabled: { enabled: boolean };
	rule_toggled: { rule: string; enabled: boolean };
	custom_rule_created: Record<string, never>;
	moderation_decided: { decision: "approve" | "deny" };
	setup_prompt_copied: { has_run_code: boolean };
	agent_setup_prompt_dismissed: { count: 1 | 2 };
	agent_setup_prompt_shown: { reminder: boolean };
	onboarding_started: Record<string, never>;
	onboarding_completed: Record<string, never>;
};

export function trackEvent<E extends keyof Events>(name: E, props: Events[E]) {
	try {
		void track(name, props);
	} catch {}
}

const ANON_ID = /^anon_[0-9a-f-]{36}$/;
const SESSION_ID = /^sess_[0-9a-f-]{36}$/;

export type TrackingSearch = { anonId?: string; sessionId?: string };

const trackingSearchSchema = z.object({
	anonId: z.string().regex(ANON_ID).optional().catch(undefined),
	sessionId: z.string().regex(SESSION_ID).optional().catch(undefined),
});

export function trackingSearch<SearchInput>(
	search: SearchInput,
): TrackingSearch {
	const parsed = trackingSearchSchema.parse(search);
	const result: TrackingSearch = {};
	if (parsed.anonId !== undefined) {
		result.anonId = parsed.anonId;
	}
	if (parsed.sessionId !== undefined) {
		result.sessionId = parsed.sessionId;
	}
	return result;
}
