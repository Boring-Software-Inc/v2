import {
	type Forge,
	type InstallationAccount,
	installationAccountSchema,
} from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Db } from "../client.ts";
import { events } from "../schema/events.ts";
import { installationAccounts } from "../schema/installation-accounts.ts";

/** Metadata may arrive before an installation is claimed; recovery observations and normalized history preserve it without creating an ownership claim. */
export async function readObservedInstallationAccounts(
	db: Db,
	forge: Forge,
	installationIds: string[],
): Promise<Map<string, InstallationAccount>> {
	const accounts = new Map<string, InstallationAccount>();
	if (installationIds.length === 0) return accounts;
	const installationId = sql<string>`${events.normalized}->'installation'->>'externalId'`;
	const [cached, rows] = await Promise.all([
		db
			.select({
				externalId: installationAccounts.installationId,
				account: installationAccounts.accountLogin,
				accountType: installationAccounts.accountType,
			})
			.from(installationAccounts)
			.where(
				and(
					eq(installationAccounts.forge, forge),
					inArray(installationAccounts.installationId, installationIds),
				),
			),
		db
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
			.orderBy(installationId, desc(events.receivedAt), desc(events.id)),
	]);
	for (const row of rows) {
		const parsed = installationAccountSchema.safeParse(row.installation);
		if (parsed.success) accounts.set(parsed.data.externalId, parsed.data);
	}
	for (const row of cached) {
		const parsed = installationAccountSchema.safeParse(row);
		if (parsed.success) accounts.set(parsed.data.externalId, parsed.data);
	}
	return accounts;
}

export async function recordObservedInstallationAccount(
	db: Db,
	forge: Forge,
	input: InstallationAccount,
): Promise<void> {
	const parsed = installationAccountSchema.safeParse(input);
	if (
		!parsed.success ||
		parsed.data.accountType === undefined ||
		parsed.data.account.length === 0
	)
		return;
	await db
		.insert(installationAccounts)
		.values({
			id: generateId(),
			forge,
			installationId: parsed.data.externalId,
			accountLogin: parsed.data.account,
			accountType: parsed.data.accountType,
		})
		.onConflictDoUpdate({
			target: [installationAccounts.forge, installationAccounts.installationId],
			set: {
				accountLogin: parsed.data.account,
				accountType: parsed.data.accountType,
				observedAt: new Date(),
			},
		});
}
