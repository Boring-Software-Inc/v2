/**
 * THE auditable mutation-surface classification (§4, amendment). Every server
 * function in `apps/web/src/lib/*.functions.ts` MUST appear here; the
 * structural test fails the build on any unclassified function AND asserts
 * each fn's middleware chain matches its class:
 *
 *   public — bare createServerFn; session-less or self-gating by design.
 *   authed — accessGuardMiddleware only (approved session; no org context).
 *   member — accessGuard + orgMemberMiddleware (org-scoped read).
 *   admin  — accessGuard + orgAdminMiddleware (org-scoped mutation).
 */
export type ServerFnClass = "public" | "authed" | "member" | "admin";

export const SERVER_FN_CLASSIFICATION: Record<string, ServerFnClass> = {
	// ── public (deliberately reachable without the beta gate) ───────────
	getSessionInfo: "public", // feeds the gate, queue screen, unauth
	getCurrentUser: "public", // caller's OWN identity; no product data
	getRun: "public", // unlisted-public run page (§10)
	/**
	 * Redemption is how a pending user BECOMES approved (§6) — behind the
	 * access gate it would deadlock. Session required inside; everything else
	 * (expiry, uses, revocation, idempotency, inviter rule) is transactional
	 * in the service.
	 */
	redeemOrgInvite: "public",

	// ── authed (approved session, no org scope) ─────────────────────────
	listMyOrgs: "authed", // the caller's own memberships
	createOrg: "authed", // any approved user may found a team org
	submitFeedback: "authed", // product feedback, not org data
	getInstallPreview: "authed", // pre-claim: caller may not be an admin yet
	listClaimableInstallations: "authed", // recovery for id-less setup callbacks

	// ── member (org-scoped reads + self-scoped org actions) ─────────────
	getOrgContext: "member",
	getOrgRepoContext: "member",
	getOrgAnalyticsSummary: "member",
	getOrgHomeState: "member",
	listOrgMembers: "member",
	leaveOrg: "member", // the guarded door out (last-admin blocks)
	getActivityFeed: "member",
	getModerationStats: "member",
	getAnalyticsActivity: "member",
	getLatestRunId: "member",
	listRuleConfigViews: "member",
	getRulesHeaderStats: "member",
	listRepoWorkflows: "member",
	getRepoWorkflow: "member",
	listModerationQueue: "member",

	// ── admin (org mutations) ────────────────────────────────────────────
	updateOrg: "admin",
	getOrgCascade: "admin", // pre-delete enumeration — admin surface
	deleteOrg: "admin",
	updateOrgMemberRole: "admin",
	removeOrgMember: "admin",
	createOrgInvite: "admin",
	listOrgInvites: "admin", // tokens are minted here; treat the list as admin
	revokeOrgInvite: "admin",
	getOrgInstallUrl: "admin", // mints an org-bound install state
	claimInstallation: "admin",
	moveInstallationToOrg: "admin",
	armRepo: "admin",
	disarmRepo: "admin",
	armRepoById: "admin",
	createRepoWorkflow: "admin",
	saveRepoWorkflow: "admin",
	renameRepoWorkflow: "admin",
	duplicateRepoWorkflow: "admin",
	deleteRepoWorkflow: "admin",
	setRepoWorkflowEnabled: "admin",
	saveRuleConfig: "admin",
	/**
	 * Approving a paused run releases code through the gate — a trust-level
	 * action, not triage (admin under the two-role model). First candidate
	 * for a per-org setting / third role when a customer needs member-level
	 * triage; the middleware + this row are the one-site change.
	 */
	decideModeration: "admin",
};
