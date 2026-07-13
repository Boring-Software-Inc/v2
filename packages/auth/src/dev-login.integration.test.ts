import { afterAll, beforeAll, expect, test } from "bun:test";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
	type TestDatabase,
} from "@tripwire/db";
import { createAuth } from "./server.ts";

/**
 * The dev persona switcher mints a REAL better-auth session via email/password
 * (bypassing OAuth, never verification — §13). This proves the mechanism: the
 * `devLogin` flag enables sign-up/sign-in and a minted cookie resolves to the
 * user; with the flag OFF (production), the endpoints are absent.
 */
let container: TestDatabase;
let db: Db;
let pool: { end(): Promise<void> };

beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
}, 120_000);

afterAll(async () => {
	await pool?.end().catch(() => undefined);
	await container?.stop();
});

function cookieHeader(res: Response): string {
	const setCookies = res.headers.getSetCookie();
	// "name=value; Path=/; HttpOnly; ..." → "name=value"
	return setCookies.map((c) => c.split(";")[0]).join("; ");
}

test("devLogin enables email/password minting; cookie resolves to the user", async () => {
	const auth = createAuth({
		db,
		secret: "test-secret-please-ignore",
		baseUrl: "http://localhost:3000",
		github: null,
		devLogin: true,
	});

	const signUp = await auth.api.signUpEmail({
		body: {
			email: "active@tripwire.demo",
			password: "tripwire-dev-persona",
			name: "active dashboard",
		},
		asResponse: true,
	});
	expect(signUp.ok).toBe(true);
	const cookie = cookieHeader(signUp);
	expect(cookie.length).toBeGreaterThan(0);

	const session = await auth.api.getSession({
		headers: new Headers({ cookie }),
	});
	expect(session?.user.email).toBe("active@tripwire.demo");

	// Re-signing in the same persona works (the switcher's returning path).
	const signIn = await auth.api.signInEmail({
		body: { email: "active@tripwire.demo", password: "tripwire-dev-persona" },
		asResponse: true,
	});
	expect(signIn.ok).toBe(true);
	expect(cookieHeader(signIn).length).toBeGreaterThan(0);
});

test("without devLogin (production) email sign-up is refused", async () => {
	const auth = createAuth({
		db,
		secret: "test-secret-please-ignore",
		baseUrl: "http://localhost:3000",
		github: null,
		devLogin: false,
	});
	const res = await auth.api
		.signUpEmail({
			body: {
				email: "nope@tripwire.demo",
				password: "tripwire-dev-persona",
				name: "nope",
			},
			asResponse: true,
		})
		.catch((err: unknown) => err as { status?: number });
	// Either a rejection or a non-ok Response — never a successful sign-up.
	const ok = res instanceof Response && res.ok;
	expect(ok).toBe(false);
});
