import {
	type Forge,
	type ForgeConnection,
	forgeConnectionSchema,
} from "@tripwire/contracts";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../client.ts";
import { account, user } from "../schema/auth.ts";
import { listClaimableInstallations } from "./organizations.ts";

/**
 * A maintainer's linked forge account (Better Auth `account` row). The provider
 * id IS the forge slug, so the same lookup serves every forge. The access token
 * drives that forge's adapter reads + onboarding.
 */
export interface ForgeAccount {
	/** The forge's account id — for GitLab, the "installation" grouping key. */
	accountId: string;
	/** OAuth access token, or null when the provider stored none. */
	accessToken: string | null;
	/** Refresh token, for forges whose access tokens expire (GitLab: 2h). */
	refreshToken: string | null;
	/** When `accessToken` dies. null ⇒ non-expiring, or the provider said nothing. */
	accessTokenExpiresAt: Date | null;
}

const FORGE_ACCOUNT_COLUMNS = {
	accountId: account.accountId,
	accessToken: account.accessToken,
	refreshToken: account.refreshToken,
	accessTokenExpiresAt: account.accessTokenExpiresAt,
} as const;

/** The maintainer's account on `forge`, or null when they have not linked it. */
export async function getForgeAccount(
	db: Db,
	userId: string,
	forge: Forge,
): Promise<ForgeAccount | null> {
	const rows = await db
		.select(FORGE_ACCOUNT_COLUMNS)
		.from(account)
		.where(and(eq(account.userId, userId), eq(account.providerId, forge)))
		.limit(1);
	return rows[0] ?? null;
}

/**
 * The forge account by its EXTERNAL id — the worker's per-repo lookup for OAuth
 * forges (a repo's `installationId` is the account's external id). Returns the
 * whole token set, not just the access token: the caller has to be able to see
 * that it expired and refresh it. Null when the account is gone.
 */
export async function getForgeAccountByExternalId(
	db: Db,
	forge: Forge,
	accountId: string,
): Promise<ForgeAccount | null> {
	const rows = await db
		.select(FORGE_ACCOUNT_COLUMNS)
		.from(account)
		.where(and(eq(account.providerId, forge), eq(account.accountId, accountId)))
		.limit(1);
	return rows[0] ?? null;
}

/**
 * Persist a refreshed token pair. GitLab refresh tokens are single use, so the
 * new refresh token MUST land here or the account is bricked until the user
 * re-authorizes — this is the write half of every refresh, never optional.
 */
export async function updateForgeAccountTokens(
	db: Db,
	forge: Forge,
	accountId: string,
	tokens: {
		accessToken: string;
		refreshToken: string | null;
		accessTokenExpiresAt: Date | null;
	},
): Promise<void> {
	await db
		.update(account)
		.set({
			accessToken: tokens.accessToken,
			refreshToken: tokens.refreshToken,
			accessTokenExpiresAt: tokens.accessTokenExpiresAt,
			updatedAt: new Date(),
		})
		.where(
			and(eq(account.providerId, forge), eq(account.accountId, accountId)),
		);
}

/** Refresh a shade before the deadline so an in-flight job can't straddle it. */
const REFRESH_SKEW_MS = 60_000;

export interface RefreshedTokens {
	accessToken: string;
	refreshToken: string | null;
	/** Seconds until the new access token expires, or null if unbounded. */
	expiresIn: number | null;
}

/**
 * A usable access token for `accountId`, refreshing it first if it is expired or
 * about to be. THE single path — api and worker both call this, so a given
 * account has one refresh implementation across both processes.
 *
 * Concurrency is handled by COMPARE-AND-SWAP, not a lock. The write only lands
 * if `refresh_token` is still the value we spent; if another process refreshed
 * while our POST was in flight, zero rows update and we re-read and use theirs.
 * No row lock is held across the network call, so a slow or hung forge can never
 * block another process — and there is no timeout to guess at.
 *
 * This tolerates a rare double-spend (both processes POST the same single-use
 * token, the forge rejects one) rather than preventing it: the loser throws, the
 * job retries, and the retry reads the winner's fresh token. Cheap and
 * self-healing, where a lock would trade that for a stall.
 *
 * `refresh` is injected because this package may not import a forge adapter.
 *
 * Throws when the account is missing, has no refresh token, or the forge refuses
 * the refresh — all of which mean re-authorization, not retry.
 */
export async function getFreshForgeToken(
	db: Db,
	forge: Forge,
	accountId: string,
	refresh: (refreshToken: string) => Promise<RefreshedTokens>,
): Promise<string> {
	const current = await getForgeAccountByExternalId(db, forge, accountId);
	if (!current?.accessToken) {
		throw new Error(`no ${forge} token for account ${accountId}`);
	}
	const expiry = current.accessTokenExpiresAt?.getTime();
	// No expiry recorded ⇒ the provider issues non-expiring tokens (GitHub
	// OAuth). Nothing to refresh.
	if (expiry === undefined || expiry - REFRESH_SKEW_MS > Date.now()) {
		return current.accessToken;
	}
	if (!current.refreshToken) {
		throw new Error(
			`${forge} token expired for account ${accountId} — re-authorization required`,
		);
	}

	const spent = current.refreshToken;
	const next = await refresh(spent);
	const updated = await db
		.update(account)
		.set({
			accessToken: next.accessToken,
			// The new refresh token REPLACES the spent one. Falling back to the old
			// value is wrong for GitLab but right for forges that omit it on
			// refresh, and it is never worse than storing null.
			refreshToken: next.refreshToken ?? spent,
			accessTokenExpiresAt: next.expiresIn
				? new Date(Date.now() + next.expiresIn * 1000)
				: null,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(account.providerId, forge),
				eq(account.accountId, accountId),
				// The swap guard. Lost the race ⇒ 0 rows.
				eq(account.refreshToken, spent),
			),
		)
		.returning({ accountId: account.accountId });

	if (updated.length > 0) {
		return next.accessToken;
	}
	// Someone else refreshed mid-flight. Ours may already be revoked by their
	// refresh, so use the row's value rather than the one we just minted.
	const winner = await getForgeAccountByExternalId(db, forge, accountId);
	if (!winner?.accessToken) {
		throw new Error(
			`${forge} token vanished for account ${accountId} — re-authorization required`,
		);
	}
	return winner.accessToken;
}

export async function setUserTimezone(
	db: Db,
	input: { userId: string; timezone: string | null },
): Promise<void> {
	await db
		.update(user)
		.set({ timezone: input.timezone, updatedAt: new Date() })
		.where(eq(user.id, input.userId));
}

export async function setUserReduceAgentMotion(
	db: Db,
	input: { userId: string; reduce: boolean },
): Promise<void> {
	await db
		.update(user)
		.set({ reduceAgentMotion: input.reduce, updatedAt: new Date() })
		.where(eq(user.id, input.userId));
}

/**
 * GitHub repos belong to App installations, not OAuth accounts. Count member-org
 * repos and unclaimed installs whose ownership the caller has proved.
 */
export async function listForgeConnections(
	db: Db,
	userId: string,
): Promise<ForgeConnection[]> {
	const claimable = await listClaimableInstallations(db, {
		userId,
		forge: "github",
	});
	const claimableGithubIds = claimable.map(
		(installation) => installation.installationId,
	);
	const canClaimGithub = claimableGithubIds.length
		? inArray(sql`r.installation_id`, claimableGithubIds)
		: sql`false`;
	const result = await db.execute(sql`
		SELECT a.provider_id AS forge,
		       a.account_id AS "accountId",
		       a.access_token_expires_at AS "accessTokenExpiresAt",
		       (a.refresh_token IS NOT NULL) AS "canRefresh",
		       r.total AS "repoCount", r.unclaimed AS "unclaimedCount"
		FROM account a
		LEFT JOIN LATERAL (
		  SELECT count(*)::int AS total,
		         (count(*) FILTER (WHERE r.org_id IS NULL))::int AS unclaimed
		  FROM repos r
		  WHERE r.forge = a.provider_id AND r.removed_at IS NULL
		    AND CASE WHEN a.provider_id IN ('github', 'gitcafe') THEN (
		      EXISTS (
		        SELECT 1 FROM member m
		        WHERE m.organization_id = r.org_id AND m.user_id = a.user_id
		      ) OR (a.provider_id = 'github' AND r.org_id IS NULL AND ${canClaimGithub})
		    ) ELSE r.installation_id = a.account_id END
		) r ON true
		WHERE a.user_id = ${userId}
		ORDER BY a.provider_id
	`);
	return result.rows.flatMap((row) => {
		const parsed = forgeConnectionSchema.safeParse(row);
		return parsed.success ? [parsed.data] : [];
	});
}
