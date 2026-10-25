import { track } from "@databuddy/sdk";

type Events = {
	signed_in: Record<string, never>;
	beta_approved: { count: number };
	github_app_install_started: { forge: string };
	installation_claimed: { forge: string };
	repo_activated: Record<string, never>;
	workflow_created: { from_template: boolean };
	workflow_enabled: { enabled: boolean };
	rule_toggled: { rule: string; enabled: boolean };
	rule_outcome_set: { rule: string; outcome: string };
	custom_rule_created: Record<string, never>;
	moderation_decided: { decision: "approve" | "deny" };
	setup_prompt_copied: { has_run_code: boolean };
	agent_setup_prompt_dismissed: { count: 1 | 2 };
	agent_setup_prompt_shown: { reminder: boolean };
};

export function trackEvent<E extends keyof Events>(name: E, props: Events[E]) {
	try {
		void track(name, props);
	} catch {}
}

const ANON_ID = /^anon_[0-9a-f-]{36}$/;
const SESSION_ID = /^sess_[0-9a-f-]{36}$/;

export type TrackingSearch = { anonId?: string; sessionId?: string };

export function trackingSearch(
	search: Record<string, unknown>,
): TrackingSearch {
	const out: TrackingSearch = {};
	if (typeof search.anonId === "string" && ANON_ID.test(search.anonId)) {
		out.anonId = search.anonId;
	}
	if (
		typeof search.sessionId === "string" &&
		SESSION_ID.test(search.sessionId)
	) {
		out.sessionId = search.sessionId;
	}
	return out;
}
