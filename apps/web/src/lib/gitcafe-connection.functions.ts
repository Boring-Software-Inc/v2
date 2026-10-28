import { createServerFn } from "@tanstack/react-start";
import {
	type GitCafeAuthorizationResponse,
	type GitCafeConnectionConfirmationResult,
	type GitCafeConnectionStatus,
	type GitCafeSetupContext,
	gitCafeAuthorizationResponseSchema,
	gitCafeConnectionConfirmationResultSchema,
	gitCafeConnectionConfirmationSchema,
	gitCafeConnectionSelectionSchema,
	gitCafeConnectionStatusInputSchema,
	gitCafeConnectionStatusSchema,
	gitCafeSetupContextSchema,
	gitCafeSetupInputSchema,
} from "@tripwire/contracts";
import type { OrgWithRole } from "@tripwire/db";
import { accessGuardMiddleware } from "#/lib/server/gated-server-fn";
import { orgPermissionMiddleware } from "#/lib/server/org-guard";
import { sameOriginMiddleware } from "#/lib/server/staff-guard";

/** Installation state and callback org are hints; current membership supplies the choices. */
export const getGitCafeSetupContext = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware])
	.inputValidator((input: unknown) => gitCafeSetupInputSchema.parse(input))
	.handler(async ({ data }): Promise<GitCafeSetupContext> => {
		const { getAuth } = await import("#/lib/server/auth");
		const { getStartContext } = await import("@tanstack/start-storage-context");
		const auth = getAuth();
		const current = await auth?.api.getSession({
			headers: getStartContext().request.headers,
		});
		if (!current)
			return gitCafeSetupContextSchema.parse({ orgs: [], suggestedOrg: null });
		const { getDb } = await import("#/lib/server/db");
		const { orgServices } = await import("@tripwire/db");
		const { memberPermissions } = await import("@tripwire/auth/org-gate");
		const { verifyInstallState } = await import("#/lib/server/install-state");
		const db = getDb().db;
		const memberships = await orgServices.listUserOrgs(db, current.user.id);
		const allowed = await Promise.all(
			memberships.map(async (org) => {
				const permissions = await memberPermissions(db, {
					orgId: org.id,
					userId: current.user.id,
				});
				return permissions?.includes("connections:manage")
					? { id: org.id, slug: org.slug, name: org.name }
					: null;
			}),
		);
		const orgs = allowed.filter((org) => org !== null);
		const hint = verifyInstallState(data.state);
		const suggestedId =
			hint?.forge === "gitcafe" && hint.userId === current.user.id
				? hint.orgId
				: data.orgId;
		return gitCafeSetupContextSchema.parse({
			orgs,
			suggestedOrg: orgs.find((org) => org.id === suggestedId)?.slug ?? null,
		});
	});

export const startGitCafeConnection = createServerFn({ method: "POST" })
	.middleware([
		accessGuardMiddleware,
		orgPermissionMiddleware("connections:manage"),
		sameOriginMiddleware,
	])
	.inputValidator((input: unknown) =>
		gitCafeConnectionSelectionSchema.parse(input),
	)
	.handler(async ({ data, context }): Promise<GitCafeAuthorizationResponse> => {
		const org = (context as { org: OrgWithRole }).org;
		const { startGitCafeGrant } = await import(
			"#/lib/server/gitcafe-connection"
		);
		return gitCafeAuthorizationResponseSchema.parse(
			await startGitCafeGrant(org.id, data.installationId),
		);
	});

export const confirmGitCafeConnection = createServerFn({ method: "POST" })
	.middleware([
		accessGuardMiddleware,
		orgPermissionMiddleware("connections:manage"),
		sameOriginMiddleware,
	])
	.inputValidator((input: unknown) =>
		gitCafeConnectionConfirmationSchema.parse(input),
	)
	.handler(
		async ({ data, context }): Promise<GitCafeConnectionConfirmationResult> => {
			const org = (context as { org: OrgWithRole }).org;
			const { confirmGitCafeGrant } = await import(
				"#/lib/server/gitcafe-connection"
			);
			return gitCafeConnectionConfirmationResultSchema.parse(
				await confirmGitCafeGrant(
					org.id,
					data.installationId,
					data.proofHandle,
				),
			);
		},
	);

export const getGitCafeConnectionStatus = createServerFn({ method: "GET" })
	.middleware([
		accessGuardMiddleware,
		orgPermissionMiddleware("connections:manage"),
	])
	.inputValidator((input: unknown) =>
		gitCafeConnectionStatusInputSchema.parse(input),
	)
	.handler(async ({ data, context }): Promise<GitCafeConnectionStatus> => {
		const org = (context as { org: OrgWithRole }).org;
		const { readGitCafeConnectionStatus } = await import(
			"#/lib/server/gitcafe-connection"
		);
		return gitCafeConnectionStatusSchema.parse(
			await readGitCafeConnectionStatus(
				org.id,
				data.installationId,
				data.jobId,
			),
		);
	});
