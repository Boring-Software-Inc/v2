import { captureMessage } from "@sentry/bun";
import {
	type Db,
	orgServices,
	type UnprovenInstallationClaim,
} from "@tripwire/db";
import type { Logger } from "pino";

export const AUDIT_INSTALLATION_CLAIMS_QUEUE = "audit-installation-claims";

export interface AuditInstallationClaimsDeps {
	db: Db;
	logger: Logger;
	capture?: typeof captureMessage;
}

export function unprovenClaimEvent(claim: UnprovenInstallationClaim) {
	return {
		level: "error" as const,
		tags: {
			installation_id: claim.installationId,
			org_slug: claim.orgSlug,
		},
		extra: { orgId: claim.orgId, account: claim.account },
	};
}

export async function auditInstallationClaims(
	deps: AuditInstallationClaimsDeps,
): Promise<UnprovenInstallationClaim[]> {
	const capture = deps.capture ?? captureMessage;
	const claims = await orgServices.listUnprovenInstallationClaims(deps.db);
	for (const claim of claims) {
		deps.logger.error(
			{
				tags: {
					installation_id: claim.installationId,
					org_slug: claim.orgSlug,
				},
				orgId: claim.orgId,
				account: claim.account,
			},
			"installation claim has no owner proof",
		);
		capture("installation claim has no owner proof", unprovenClaimEvent(claim));
	}
	deps.logger.info(
		{ unproven: claims.length },
		"installation claim audit finished",
	);
	return claims;
}
