import type { InstallationEvent } from "@tripwire/contracts";
import type { Db } from "@tripwire/db";
import { orgServices, repoServices } from "@tripwire/db";
import type { Logger } from "pino";

export interface InstallationUpsert {
	installationId: string;
	account: string;
	accountType: InstallationEvent["installation"]["accountType"];
	repositories: InstallationEvent["repositories"];
}

export async function upsertInstallation(
	db: Db,
	input: InstallationUpsert,
	logger: Logger,
): Promise<void> {
	const { installationId } = input;
	const orgId = await orgServices.getInstallationOrg(db, { installationId });
	await repoServices.syncInstallationRepos(
		db,
		installationId,
		input.repositories,
		[],
		orgId,
	);
	await orgServices.recordInstallationAccount(db, {
		installationId,
		accountType: input.accountType,
		accountLogin: input.account,
	});
	if (orgId) {
		logger.info({ installationId, orgId }, "installation resolved to org");
	} else {
		logger.info(
			{ installationId, account: input.account },
			"installation unclaimed, repos synced without org, awaiting claim",
		);
	}
}
