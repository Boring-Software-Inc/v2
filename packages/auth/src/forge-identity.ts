import { type Forge, forgeSchema } from "@tripwire/contracts";
import type { Db } from "@tripwire/db";
import { schema } from "@tripwire/db";
import { generateId } from "@tripwire/utils";
import { and, eq } from "drizzle-orm";

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const GITHUB_USER_URL = "https://api.github.com/user";
const LOGIN_TIMEOUT_MS = 5000;

export async function githubLogin(
	accessToken: string | null | undefined,
	fetcher: Fetch = fetch,
): Promise<string | null> {
	if (!accessToken) {
		return null;
	}
	try {
		const res = await fetcher(GITHUB_USER_URL, {
			headers: {
				accept: "application/vnd.github+json",
				authorization: `Bearer ${accessToken}`,
				"user-agent": "tripwire",
			},
			signal: AbortSignal.timeout(LOGIN_TIMEOUT_MS),
		});
		if (!res.ok) {
			return null;
		}
		const body: unknown = await res.json();
		if (
			typeof body === "object" &&
			body !== null &&
			"login" in body &&
			typeof body.login === "string" &&
			body.login.length > 0
		) {
			return body.login;
		}
		return null;
	} catch {
		return null;
	}
}

export async function forgeLogin(
	forge: Forge,
	accessToken: string | null | undefined,
	fetcher: Fetch = fetch,
): Promise<string | null> {
	return forge === "github" ? await githubLogin(accessToken, fetcher) : null;
}

export interface LinkedAccount {
	userId: string;
	providerId: string;
	accountId: string;
	accessToken?: string | null;
}

export async function mirrorForgeIdentity(
	db: Db,
	account: LinkedAccount,
	fetcher: Fetch = fetch,
): Promise<void> {
	const forge = forgeSchema.safeParse(account.providerId);
	if (!forge.success) {
		return;
	}
	const login = await forgeLogin(forge.data, account.accessToken, fetcher);
	const users = await db
		.select({ name: schema.user.name })
		.from(schema.user)
		.where(eq(schema.user.id, account.userId));
	const username = login ?? users[0]?.name ?? account.userId;
	const insert = db.insert(schema.forgeIdentities).values({
		id: generateId(),
		userId: account.userId,
		forge: forge.data,
		externalId: account.accountId,
		username,
	});
	await (login
		? insert.onConflictDoUpdate({
				target: [
					schema.forgeIdentities.forge,
					schema.forgeIdentities.externalId,
				],
				set: { username: login },
			})
		: insert.onConflictDoNothing());
}

export async function refreshForgeLogin(
	db: Db,
	account: Partial<LinkedAccount>,
	fetcher: Fetch = fetch,
): Promise<void> {
	const forge = forgeSchema.safeParse(account.providerId);
	if (!(forge.success && account.accountId)) {
		return;
	}
	const login = await forgeLogin(forge.data, account.accessToken, fetcher);
	if (!login) {
		return;
	}
	await db
		.update(schema.forgeIdentities)
		.set({ username: login })
		.where(
			and(
				eq(schema.forgeIdentities.forge, forge.data),
				eq(schema.forgeIdentities.externalId, account.accountId),
			),
		);
}
