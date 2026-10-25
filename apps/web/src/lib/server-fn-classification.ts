/**
 * THE auditable mutation-surface classification (§4, amendment). Every server
 * function in `apps/web/src/lib/*.functions.ts` MUST appear here; the
 * structural test fails the build on any unclassified function AND asserts
 * each fn's middleware chain matches its class:
 *
 *   public — bare createServerFn; session-less or self-gating by design.
 *   authed — accessGuardMiddleware only (approved session; no org context).
 *   member — accessGuard + orgMemberMiddleware (org shell: any role).
 *   staff  — accessGuard + platformAdminMiddleware (/admin portal; platform
 *            role on the user row, NOT org membership; denial is always 404).
 *   permission:<region>:<read|manage> — accessGuard +
 *            orgPermissionMiddleware("<region>:<level>"). Every org-scoped fn
 *            outside the shell carries one (#37).
 */
import type { OrgPermission } from "@tripwire/auth/org-access";

export type ServerFnClass =
	| "public"
	| "authed"
	| "member"
	| "staff"
	| `permission:${OrgPermission}`;

export const SERVER_FN_CLASSIFICATION: Record<string, ServerFnClass> = {
	// ── public (deliberately reachable without the beta gate) ───────────
	getSessionInfo: "public", // feeds the gate, queue screen, unauth
	getCurrentUser: "public", // caller's OWN identity; no product data
	getRun: "public", // unlisted-public run page (§10)
	getWebviewHost: "public", // reads the caller's own user-agent; /login is signed-out
	/**
	 * Redemption is how a pending user BECOMES approved (§6) — behind the
	 * access gate it would deadlock. Session required inside; everything else
	 * (expiry, uses, revocation, idempotency, inviter rule) is transactional
	 * in the service.
	 */
	redeemOrgInvite: "public",
	stopImpersonating: "public",
	recordDatabuddyAnonId: "public",

	// ── authed (approved session, no org scope) ─────────────────────────
	listMyOrgs: "authed", // the caller's own memberships
	createOrg: "authed", // any approved user may found a team org
	submitFeedback: "authed", // product feedback, not org data
	getInstallPreview: "authed", // pre-claim: caller may not be an admin yet
	recoverInstallation: "authed", // checks the caller's own access to an install
	listClaimableInstallations: "authed", // recovery for id-less setup callbacks
	listApprovedInstallRequests: "authed",
	/**
	 * A forge connection belongs to the USER, not an org — it is the caller's own
	 * oauth link, and the same account can back repos in several orgs. Both carry
	 * accessGuard alone, which is what `authed` means; org-scoping either one
	 * would lock a user out of managing a connection they own.
	 */
	listForgeConnections: "authed",
	disconnectForge: "authed",
	getConsentRequest: "authed", // the caller's own agent consent
	grantConsentOrgs: "authed", // grants only orgs the caller belongs to
	getDeviceRequest: "authed", // the caller's own cli sign-in
	grantDeviceOrgs: "authed", // grants only orgs the caller belongs to
	listConnectedAgents: "authed", // the caller's own agents
	revokeConnectedAgent: "authed", // the caller's own agents
	listMySessions: "authed",
	revokeMySession: "authed",
	revokeMyOtherSessions: "authed",
	getAccountDeletionPlan: "authed",
	deleteMyAccount: "authed",
	setAccountTimezone: "authed",
	setAgentMotion: "authed",

	// ── member (org shell: any role, including custom roles) ─────────────
	getOrgContext: "member",
	getOrgRepoContext: "member",
	getOrgHomeState: "member",
	rememberActiveOrg: "member",
	leaveOrg: "member", // the guarded door out (last-admin blocks)

	// ── moderation (human review) ─────────────────────────────────────────
	listModerationQueue: "permission:moderation:read",
	decideModeration: "permission:moderation:manage",

	// ── activity (runs) ───────────────────────────────────────────────────
	getActivityFeed: "permission:activity:read",
	getLatestRunId: "permission:activity:read",
	rerunChangeRequest: "permission:activity:manage",
	getRerunPreview: "permission:activity:manage",

	// ── rules ─────────────────────────────────────────────────────────────
	listRuleConfigViews: "permission:rules:read",
	listCustomRuleViews: "permission:rules:read",
	getRulesHeaderStats: "permission:rules:read",
	getRepoSuggestions: "permission:rules:read",
	getRuleLibrary: "permission:rules:read",
	saveRuleConfig: "permission:rules:manage",
	setRulesEnabled: "permission:rules:manage",
	setRuleOutcome: "permission:rules:manage",
	upgradeRuleConfig: "permission:rules:manage",
	saveCustomRule: "permission:rules:manage",
	setCustomRuleEnabled: "permission:rules:manage",
	deleteCustomRule: "permission:rules:manage",

	// ── workflows ─────────────────────────────────────────────────────────
	listRepoWorkflows: "permission:workflows:read",
	getRepoWorkflow: "permission:workflows:read",
	listRepoReviewers: "permission:workflows:read",
	listRepoLabels: "permission:workflows:read",
	createRepoWorkflow: "permission:workflows:manage",
	addRuleException: "permission:workflows:manage",
	saveRepoWorkflow: "permission:workflows:manage",
	renameRepoWorkflow: "permission:workflows:manage",
	duplicateRepoWorkflow: "permission:workflows:manage",
	deleteRepoWorkflow: "permission:workflows:manage",
	promoteRepoDraft: "permission:workflows:manage",
	discardRepoDraft: "permission:workflows:manage",
	getWorkflowPushReview: "permission:workflows:manage",
	decideWorkflowPush: "permission:workflows:manage",
	setRepoWorkflowEnabled: "permission:workflows:manage",
	testDeliveryConnection: "permission:workflows:manage", // makes an outbound request
	refreshRepoReviewers: "permission:workflows:manage",
	refreshRepoLabels: "permission:workflows:manage",

	// ── responses + redaction ─────────────────────────────────────────────
	getRepoResponseConfig: "permission:responses:read",
	getOrgResponseDefaults: "permission:responses:read",
	saveRepoResponseConfig: "permission:responses:manage",
	saveOrgResponseDefaults: "permission:responses:manage",
	searchCloseGifs: "permission:responses:manage",

	// ── analytics ─────────────────────────────────────────────────────────
	getOrgAnalyticsSummary: "permission:analytics:read",
	getAnalyticsActivity: "permission:analytics:read",
	getModerationStats: "permission:analytics:read",

	// ── connections (installs, claims, turning repos on) ──────────────────
	getOrgInstallUrl: "permission:connections:manage", // mints an org-bound install state
	claimInstallation: "permission:connections:manage",
	moveInstallationToOrg: "permission:connections:manage",
	armRepo: "permission:connections:manage",
	disarmRepo: "permission:connections:manage",
	armRepoById: "permission:connections:manage",
	disarmRepoById: "permission:connections:manage",
	ensureSetupRun: "permission:connections:manage", // a setup run is an install-and-gate act
	findSetupRun: "permission:connections:manage",
	getAgentSetupPrompt: "permission:connections:manage",
	dismissAgentSetupPrompt: "permission:connections:manage",
	takeOverAgentSetup: "permission:connections:manage",
	getRepoSetup: "permission:moderation:read",
	keepResponseDefaults: "permission:responses:manage",

	// ── members + roles (manage is never grantable to a custom role) ──────
	listOrgMembers: "permission:members:read",
	listOrgRoles: "permission:members:read",
	updateOrgMemberRole: "permission:members:manage",
	removeOrgMember: "permission:members:manage",
	createOrgInvite: "permission:members:manage",
	listOrgInvites: "permission:members:manage", // tokens are minted here
	revokeOrgInvite: "permission:members:manage",
	createOrgRole: "permission:members:manage",
	updateOrgRole: "permission:members:manage",
	deleteOrgRole: "permission:members:manage",

	// ── org settings (manage is never grantable to a custom role) ─────────
	updateOrg: "permission:settings:manage",
	setOrgTimezone: "permission:settings:manage",
	getOrgCascade: "permission:settings:manage", // pre-delete enumeration
	deleteOrg: "permission:settings:manage",

	// ── staff (platform admin portal — /admin) ───────────────────────────
	getAdminContext: "staff",
	getAdminOverview: "staff",
	listAdminUsers: "staff",
	listAdminOrgs: "staff",
	listAdminRepos: "staff",
	listAdminInstallations: "staff",
	listAdminOrgMembers: "staff",
	reviewUserAccess: "staff", // writes through promote/rejectUserAccess only
	adminUpdateOrgMemberRole: "staff", // shares the plugin hook's guard
	setUserRerunCooldownExempt: "staff",
	getAdminUser: "staff",
	getAdminUserFlags: "staff",
	getAdminUserActivity: "staff",
	setAdminUserFlagOverride: "staff",
	retryAdminUserFlagSync: "staff",
	setAdminUserTimezone: "staff",
	setAdminUserPlatformAdmin: "staff",
	revokeAdminUserSession: "staff",
	revokeAdminUserSessions: "staff",
	revokeAdminUserAgent: "staff",
	banAdminUser: "staff",
	unbanAdminUser: "staff",
	deleteAdminUser: "staff",
	impersonateAdminUser: "staff",
	getEconomicsOverview: "staff", // platform-wide cost data
	getEconomicsSeries: "staff",
	getCostByOrg: "staff",
	getRailwayBreakdown: "staff",
};
