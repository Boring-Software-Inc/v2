import type { Db } from "@tripwire/db";
import { schema } from "@tripwire/db";
import { generateId } from "@tripwire/utils";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";

/**
 * Better Auth (§10): GitHub OAuth only at launch. One `createAuth` shared by
 * the heads that need it (api mounts the HTTP handler, web reads sessions) —
 * stateless instances over the same database. `user.id` is UUIDv7; GitHub
 * identity lives ONLY in `account` (sign-in) and `forge_identities`.
 * Contributors never authenticate — only maintainers log in.
 */

export interface CreateAuthInput {
	db: Db;
	secret: string;
	baseUrl: string;
	github: { clientId: string; clientSecret: string } | null;
}

export function createAuth(input: CreateAuthInput) {
	return betterAuth({
		database: drizzleAdapter(input.db, {
			provider: "pg",
			schema: {
				user: schema.user,
				session: schema.session,
				account: schema.account,
				verification: schema.verification,
			},
		}),
		secret: input.secret,
		baseURL: input.baseUrl,
		advanced: {
			database: {
				generateId: () => generateId(),
			},
		},
		socialProviders: input.github
			? {
					github: {
						clientId: input.github.clientId,
						clientSecret: input.github.clientSecret,
					},
				}
			: {},
		databaseHooks: {
			account: {
				create: {
					/** §10: mirror the GitHub identity into forge_identities. */
					after: async (account) => {
						if (account.providerId !== "github") {
							return;
						}
						const users = await input.db
							.select()
							.from(schema.user)
							.where(eqUserId(account.userId));
						const username = users[0]?.name ?? account.userId;
						await input.db
							.insert(schema.forgeIdentities)
							.values({
								id: generateId(),
								userId: account.userId,
								forge: "github",
								externalId: account.accountId,
								username,
							})
							.onConflictDoNothing();
					},
				},
			},
		},
	});
}

function eqUserId(userId: string) {
	return eq(schema.user.id, userId);
}

export type Auth = ReturnType<typeof createAuth>;

export type AuthPosture = "enabled" | "open-dev";

/**
 * Fail-closed guard (hardening unit 2): the open-gate fallback exists ONLY
 * for local dev before the OAuth app exists. In production a missing
 * BETTER_AUTH_SECRET refuses to boot — a missing env var must never silently
 * publish the dashboard.
 */
export function resolveAuthPosture(input: {
	secret: string | undefined;
	nodeEnv: string | undefined;
}): AuthPosture {
	if (input.secret) {
		return "enabled";
	}
	if (input.nodeEnv === "production") {
		throw new Error(
			"BETTER_AUTH_SECRET is not set — refusing to serve in production (auth gate would stand open)",
		);
	}
	return "open-dev";
}
