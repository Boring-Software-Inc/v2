import {
	type Forge,
	type InstallationAccount,
	installationAccountSchema,
} from "@tripwire/contracts";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Db } from "../client.ts";
import { events } from "../schema/events.ts";

/** Metadata may arrive before an installation is claimed; normalized history preserves it without creating an ownership claim. */
export async function readObservedInstallationAccounts(
	db: Db,
	forge: Forge,
	installationIds: string[],
): Promise<Map<string, InstallationAccount>> {
	const accounts = new Map<string, InstallationAccount>();
	if (installationIds.length === 0) return accounts;
	const installationId = sql<string>`${events.normalized}->'installation'->>'externalId'`;
	const rows = await db
		.selectDistinctOn([installationId], {
			installation: sql<unknown>`${events.normalized}->'installation'`,
		})
		.from(events)
		.where(
			and(
				eq(events.forge, forge),
				eq(events.quarantined, false),
				isNotNull(events.normalizedAt),
				inArray(events.kind, [
					"installation.created",
					"installation-repositories.added",
					"installation-repositories.removed",
				]),
				inArray(installationId, installationIds),
			),
		)
		.orderBy(installationId, desc(events.receivedAt), desc(events.id));
	for (const row of rows) {
		const parsed = installationAccountSchema.safeParse(row.installation);
		if (parsed.success) accounts.set(parsed.data.externalId, parsed.data);
	}
	return accounts;
}
