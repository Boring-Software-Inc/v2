/**
 * THE auditable mutation-surface classification (§4, amendment). Every server
 * function in `apps/web/src/lib/*.functions.ts` MUST appear here; the
 * structural test fails the build on any unclassified function, so a new
 * endpoint cannot ship without a deliberate row in this table.
 *
 *   public — reachable without a session; the §10 allowlist. Keep SMALL.
 *   member — org-scoped read (or the caller's own data); any member.
 *   admin  — org-scoped mutation; admins only, deny-by-default.
 *
 * Checkpoint 1: classification completeness is enforced; the org-role
 * middlewares land on each fn during the checkpoint-2 URL rewrite, when fns
 * gain their (orgSlug, repo) context — at which point the test also asserts
 * the middleware chain MATCHES the class declared here.
 */
export type ServerFnClass = "public" | "member" | "admin";

export const SERVER_FN_CLASSIFICATION: Record<string, ServerFnClass> = {
	// ── public (session-less by design) ────────────────────────────────
	getSessionInfo: "public", // feeds the gate, queue screen, unauth
	getCurrentUser: "public", // caller's OWN identity; no product data
	getRun: "public", // unlisted-public run page (§10)

	// ── member (reads + self-scoped actions) ───────────────────────────
	getSwitcherRepos: "member",
	getActiveRepoInfo: "member",
	getOnboardingState: "member",
	getActivityFeed: "member",
	getModerationStats: "member",
	getAnalyticsActivity: "member",
	getLatestRunId: "member",
	listRuleConfigViews: "member",
	getRulesHeaderStats: "member",
	getWorkflowForRepo: "member",
	listModerationQueue: "member",
	submitFeedback: "member", // product feedback, not org data
	chooseActiveRepo: "member", // per-user preference; retired by the URL rewrite

	// ── admin (org mutations) ──────────────────────────────────────────
	getInstallUrl: "admin", // install targeting — mints an org-bound state
	completeInstallation: "admin",
	armActiveRepo: "admin",
	disarmActiveRepo: "admin",
	armRepoById: "admin",
	saveWorkflowForRepo: "admin",
	saveRuleConfig: "admin",
	/**
	 * Approving a paused run releases code through the gate — a trust-level
	 * action, not triage, so it sits with admin under the two-role model.
	 * First candidate for a per-org setting / third role when a customer
	 * needs member-level triage; the gate check is declared at the server fn
	 * (`need`), so loosening later is a one-site change.
	 */
	decideModeration: "admin",
};
