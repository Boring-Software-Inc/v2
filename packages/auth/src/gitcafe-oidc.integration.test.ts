import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import {
	createHash,
	generateKeyPairSync,
	type KeyObject,
	sign,
} from "node:crypto";
import {
	FORGE_CATALOG,
	GITCAFE_ISSUER,
	type GitCafeOidcClaims,
	gitCafeAuthorizationResponseSchema,
} from "@tripwire/contracts";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
	schema,
	type TestDatabase,
} from "@tripwire/db";
import { generateId } from "@tripwire/utils";
import { createAuthorizationURL, type OAuthProvider } from "better-auth/oauth2";
import { and, eq } from "drizzle-orm";
import { resolveGitCafeSignIn } from "./gitcafe-oidc.ts";
import { type Auth, createAuth } from "./server.ts";

const BASE_URL = "https://tripwire.test";
const CLIENT_ID = "gitcafe-protocol-test";
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
	modulusLength: 2048,
});
const otherKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
const jwk = {
	...publicKey.export({ format: "jwk" }),
	kid: "protocol-test",
	alg: "RS256",
	use: "sig",
};
const secret = generateId() + generateId();

type AdversarialClaims = Partial<
	Record<keyof GitCafeOidcClaims, string | number | boolean | string[] | null>
>;

interface AuthRequestBody {
	provider: string;
	callbackURL?: string;
	scopes?: string[];
	additionalParams?: { resource?: string };
	idToken?: { token: string };
}

interface FlowOptions {
	sub?: string;
	email?: string;
	handle?: string;
	claims?: AdversarialClaims;
	omitClaims?: (keyof GitCafeOidcClaims)[];
	omitIdToken?: boolean;
	signingKey?: KeyObject;
	algorithm?: string;
}

interface Flow {
	code: string;
	url: URL;
	cookie: string;
	sub: string;
	email: string;
	options: FlowOptions;
}

let container: TestDatabase;
let db: Db;
let pool: { end(): Promise<void> };
let auth: Auth;
let secondAuth: Auth;
let disabledAuth: Auth;
let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
const loggerMocks: { mockRestore(): void }[] = [];
const flows = new Map<string, Flow>();
const exchanges: {
	clientId: string | null;
	secretPresent: boolean;
	authorizationPresent: boolean;
	verifierMatches: boolean;
	redirectMatches: boolean;
}[] = [];

function cookieHeader(res: Response): string {
	return res.headers
		.getSetCookie()
		.map((cookie) => cookie.split(";")[0])
		.join("; ");
}

function createInstance(enabled = true) {
	return createAuth({
		db,
		secret,
		baseUrl: BASE_URL,
		github: null,
		opengit: null,
		gitcafe: enabled ? { clientId: CLIENT_ID } : null,
	});
}

async function post(
	path: string,
	body: AuthRequestBody,
	cookie?: string,
	instance = auth,
) {
	const headers = new Headers({
		"content-type": "application/json",
		origin: BASE_URL,
	});
	if (cookie) {
		headers.set("cookie", cookie);
	}
	return instance.handler(
		new Request(`${BASE_URL}/api/auth${path}`, {
			method: "POST",
			headers,
			body: JSON.stringify(body),
		}),
	);
}

async function start(
	options: FlowOptions = {},
	body: Partial<AuthRequestBody> = {},
	cookie?: string,
	instance = auth,
): Promise<Flow> {
	const response = await post(
		"/sign-in/social",
		{
			provider: "gitcafe",
			callbackURL: `${BASE_URL}/complete`,
			...body,
		},
		cookie,
		instance,
	);
	expect(response.ok).toBe(true);
	const payload = gitCafeAuthorizationResponseSchema.parse(
		await response.json(),
	);
	const sub = options.sub ?? generateId();
	const flow = {
		code: generateId(),
		url: new URL(payload.url),
		cookie: cookieHeader(response),
		sub,
		email: options.email ?? `${sub}@example.test`,
		options,
	};
	flows.set(flow.code, flow);
	return flow;
}

async function callback(
	flow: Flow,
	options: {
		state?: string;
		cookie?: string;
		issuer?: string;
		instance?: Auth;
	} = {},
) {
	const url = new URL(`${BASE_URL}/api/auth/callback/gitcafe`);
	url.searchParams.set("code", flow.code);
	url.searchParams.set(
		"state",
		options.state ?? flow.url.searchParams.get("state") ?? "",
	);
	url.searchParams.set("iss", options.issuer ?? GITCAFE_ISSUER);
	return (options.instance ?? auth).handler(
		new Request(url.toString(), {
			headers: { cookie: options.cookie ?? flow.cookie },
		}),
	);
}

function idToken(flow: Flow, accessToken: string): string {
	const now = Math.floor(Date.now() / 1000);
	const claims: AdversarialClaims = {
		iss: GITCAFE_ISSUER,
		sub: flow.sub,
		aud: CLIENT_ID,
		iat: now,
		exp: now + 600,
		nonce: flow.url.searchParams.get("nonce"),
		at_hash: createHash("sha256")
			.update(accessToken)
			.digest()
			.subarray(0, 16)
			.toString("base64url"),
		preferred_username: flow.options.handle ?? "protocol-test-handle",
		name: "OIDC protocol test",
		email: flow.email,
		email_verified: true,
		...flow.options.claims,
	};
	for (const claim of flow.options.omitClaims ?? []) {
		delete claims[claim];
	}
	const header = Buffer.from(
		JSON.stringify({
			alg: flow.options.algorithm ?? "RS256",
			kid: "protocol-test",
			typ: "JWT",
		}),
	).toString("base64url");
	const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
	const input = `${header}.${payload}`;
	return `${input}.${sign("RSA-SHA256", Buffer.from(input), flow.options.signingKey ?? privateKey).toString("base64url")}`;
}

async function sessionFor(response: Response, instance = auth) {
	return instance.api.getSession({
		headers: new Headers({ cookie: cookieHeader(response) }),
	});
}

async function expectRejected(flow: Flow, response: Response) {
	expect(response.headers.get("location")).toContain("error=");
	expect(await sessionFor(response)).toBeNull();
	const accounts = await db
		.select()
		.from(schema.account)
		.where(
			and(
				eq(schema.account.providerId, "gitcafe"),
				eq(schema.account.accountId, flow.sub),
			),
		);
	expect(accounts).toHaveLength(0);
}

beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
	/** Generated signatures exercise the real verifier; these are adversarial inputs, not captured fixtures. */
	fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
		Object.assign(
			async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
				const url = input instanceof Request ? input.url : String(input);
				if (url === `${GITCAFE_ISSUER}/api/oauth/jwks`) {
					return Response.json({ keys: [jwk] });
				}
				if (url !== `${GITCAFE_ISSUER}/api/oauth/token`) {
					throw new Error(
						"Unexpected outbound request in GitCafe sign-in test",
					);
				}
				const body = new URLSearchParams(String(init?.body));
				const flow = flows.get(body.get("code") ?? "");
				if (!flow) {
					return Response.json({ error: "invalid_grant" }, { status: 400 });
				}
				const verifier = body.get("code_verifier") ?? "";
				exchanges.push({
					clientId: body.get("client_id"),
					secretPresent: body.has("client_secret"),
					authorizationPresent: new Headers(init?.headers).has("authorization"),
					verifierMatches:
						createHash("sha256").update(verifier).digest("base64url") ===
						flow.url.searchParams.get("code_challenge"),
					redirectMatches:
						body.get("redirect_uri") ===
						flow.url.searchParams.get("redirect_uri"),
				});
				const accessToken = generateId();
				return Response.json({
					access_token: accessToken,
					token_type: "Bearer",
					expires_in: 900,
					scope: "openid profile email",
					refresh_token: generateId(),
					id_token: flow.options.omitIdToken
						? undefined
						: idToken(flow, accessToken),
				});
			},
			{ preconnect: globalThis.fetch.preconnect },
		),
	);
	auth = createInstance();
	secondAuth = createInstance();
	disabledAuth = createInstance(false);
	for (const instance of [auth, secondAuth, disabledAuth]) {
		const context = await instance.$context;
		loggerMocks.push(
			spyOn(context.logger, "error").mockImplementation(() => undefined),
		);
		loggerMocks.push(
			spyOn(context.logger, "warn").mockImplementation(() => undefined),
		);
	}
}, 120_000);

afterAll(async () => {
	fetchSpy?.mockRestore();
	for (const mock of loggerMocks.reverse()) {
		mock.mockRestore();
	}
	await pool?.end();
	await container?.stop();
});

describe("GitCafe opt-in public OIDC", () => {
	test("runtime gate requires explicit enablement and a client ID; catalog stays unavailable", async () => {
		expect(
			resolveGitCafeSignIn({ enabled: undefined, clientId: CLIENT_ID }),
		).toBeNull();
		expect(
			resolveGitCafeSignIn({ enabled: "false", clientId: CLIENT_ID }),
		).toBeNull();
		expect(() =>
			resolveGitCafeSignIn({ enabled: "true", clientId: undefined }),
		).toThrow();
		expect(() =>
			resolveGitCafeSignIn({ enabled: "yes", clientId: CLIENT_ID }),
		).toThrow();
		expect(
			resolveGitCafeSignIn({ enabled: "true", clientId: CLIENT_ID }),
		).toEqual({ clientId: CLIENT_ID });
		expect(
			FORGE_CATALOG.find((forge) => forge.id === "gitcafe"),
		).not.toHaveProperty("signIn");
		expect(
			(
				await post(
					"/sign-in/social",
					{ provider: "gitcafe" },
					undefined,
					disabledAuth,
				)
			).ok,
		).toBe(false);
	});

	test("S256, nonce, exact redirect and public token auth; stable subject/handle, no persisted tokens", async () => {
		const flow = await start(
			{},
			{
				scopes: ["repo:metadata:read"],
				additionalParams: { resource: "https://git.cafe/api" },
			},
		);
		expect(flow.url.origin).toBe(GITCAFE_ISSUER);
		expect(flow.url.pathname).toBe("/api/oauth/authorize");
		expect(flow.url.searchParams.get("code_challenge_method")).toBe("S256");
		expect(flow.url.searchParams.get("scope")).toBe("openid profile email");
		expect(flow.url.searchParams.has("resource")).toBe(false);
		expect(flow.url.searchParams.get("nonce")?.length).toBeGreaterThan(20);
		expect(flow.url.searchParams.get("redirect_uri")).toBe(
			`${BASE_URL}/api/auth/callback/gitcafe`,
		);
		const response = await callback(flow);
		expect(response.headers.get("location")).toBe(`${BASE_URL}/complete`);
		const session = await sessionFor(response);
		expect(session?.user.email).toBe(flow.email);
		expect(session?.user.emailVerified).toBe(true);
		expect(session?.user.id).not.toBe(flow.sub);
		const accounts = await db
			.select()
			.from(schema.account)
			.where(eq(schema.account.accountId, flow.sub));
		expect(accounts).toHaveLength(1);
		expect(accounts[0]).toMatchObject({
			providerId: "gitcafe",
			accountId: flow.sub,
			accessToken: null,
			refreshToken: null,
			idToken: null,
		});
		const identities = await db
			.select()
			.from(schema.forgeIdentities)
			.where(eq(schema.forgeIdentities.externalId, flow.sub));
		expect(identities).toHaveLength(1);
		expect(identities[0]).toMatchObject({
			userId: session?.user.id,
			forge: "gitcafe",
			username: "protocol-test-handle",
		});
		expect(exchanges.at(-1)).toEqual({
			clientId: CLIENT_ID,
			secretPresent: false,
			authorizationPresent: false,
			verifierMatches: true,
			redirectMatches: true,
		});
	});

	test("missing, wrong and absent-cookie state never reach token exchange", async () => {
		for (const options of [
			{ state: "" },
			{ state: generateId() },
			{ cookie: "" },
		]) {
			const flow = await start();
			const count = exchanges.length;
			await expectRejected(flow, await callback(flow, options));
			expect(exchanges).toHaveLength(count);
		}
	});

	test("wrong callback issuer is rejected before token exchange", async () => {
		const flow = await start();
		const count = exchanges.length;
		await expectRejected(
			flow,
			await callback(flow, { issuer: "https://open-git.com" }),
		);
		expect(exchanges).toHaveLength(count);
	});

	test("a consumed callback stays rejected with the original state cookie", async () => {
		const flow = await start();
		const first = await callback(flow);
		expect(first.headers.get("location")).toBe(`${BASE_URL}/complete`);
		const count = exchanges.length;
		const replay = await callback(flow, { instance: secondAuth });
		expect(replay.headers.get("location")).toContain("error=");
		expect(await sessionFor(replay)).toBeNull();
		expect(exchanges).toHaveLength(count);
	});

	test("concurrent callbacks on separate auth instances create one session", async () => {
		const flow = await start();
		let release = () => {};
		const barrier = new Promise<void>((resolve) => {
			release = resolve;
		});
		let readers = 0;
		const mocks = [];
		for (const instance of [auth, secondAuth]) {
			const adapter = (await instance.$context).internalAdapter;
			const original = adapter.findVerificationValue.bind(adapter);
			mocks.push(
				spyOn(adapter, "findVerificationValue").mockImplementation(
					async (identifier) => {
						const row = await original(identifier);
						if (identifier.startsWith("auth-state:")) {
							readers += 1;
							if (readers === 2) {
								release();
							}
							await barrier;
						}
						return row;
					},
				),
			);
		}
		const count = exchanges.length;
		let responses: Response[];
		try {
			responses = await Promise.all([
				callback(flow),
				callback(flow, { instance: secondAuth }),
			]);
		} finally {
			release();
			for (const mock of mocks) {
				mock.mockRestore();
			}
		}
		expect(readers).toBe(2);
		expect(exchanges).toHaveLength(count + 2);
		expect(
			responses.filter(
				(response) =>
					response.headers.get("location") === `${BASE_URL}/complete`,
			),
		).toHaveLength(1);
		const accounts = await db
			.select()
			.from(schema.account)
			.where(eq(schema.account.accountId, flow.sub));
		expect(accounts).toHaveLength(1);
		const sessions = await db
			.select()
			.from(schema.session)
			.where(eq(schema.session.userId, accounts[0]?.userId ?? ""));
		expect(sessions).toHaveLength(1);
	});

	test("independent first sign-ins racing on one subject keep one durable owner", async () => {
		const first = await start();
		const second = await start({
			sub: first.sub,
			email: `${generateId()}@example.test`,
		});
		expect(second.url.searchParams.get("state")).not.toBe(
			first.url.searchParams.get("state"),
		);
		expect(second.url.searchParams.get("nonce")).not.toBe(
			first.url.searchParams.get("nonce"),
		);
		let release = () => {};
		const barrier = new Promise<void>((resolve) => {
			release = resolve;
		});
		let readers = 0;
		const mocks = [];
		for (const instance of [auth, secondAuth]) {
			const adapter = (await instance.$context).internalAdapter;
			const original = adapter.findAccountOwnerByKey.bind(adapter);
			mocks.push(
				spyOn(adapter, "findAccountOwnerByKey").mockImplementation(
					async (key) => {
						const owner = await original(key);
						if (key.providerId === "gitcafe" && key.accountId === first.sub) {
							expect(owner).toBeNull();
							readers += 1;
							if (readers === 2) {
								release();
							}
							await barrier;
						}
						return owner;
					},
				),
			);
		}
		let responses: Response[];
		try {
			responses = await Promise.all([
				callback(first),
				callback(second, { instance: secondAuth }),
			]);
		} finally {
			release();
			for (const mock of mocks) {
				mock.mockRestore();
			}
		}
		expect(readers).toBe(2);
		const accounts = await db
			.select()
			.from(schema.account)
			.where(
				and(
					eq(schema.account.providerId, "gitcafe"),
					eq(schema.account.accountId, first.sub),
				),
			);
		expect(accounts).toHaveLength(1);
		const ownerId = accounts[0]?.userId;
		const identities = await db
			.select()
			.from(schema.forgeIdentities)
			.where(
				and(
					eq(schema.forgeIdentities.forge, "gitcafe"),
					eq(schema.forgeIdentities.externalId, first.sub),
				),
			);
		expect(identities).toHaveLength(1);
		expect(identities[0]?.userId).toBe(ownerId);
		const sessions = await Promise.all(responses.map((res) => sessionFor(res)));
		expect(sessions.filter(Boolean)).toHaveLength(1);
		expect(sessions.find(Boolean)?.user.id).toBe(ownerId);
		const users = await db
			.select()
			.from(schema.user)
			.where(eq(schema.user.email, sessions[0] ? second.email : first.email));
		expect(users).toHaveLength(1);
		const rejectedUserId = users[0]?.id ?? "";
		expect(rejectedUserId).not.toBe(ownerId);
		expect(
			await db
				.select()
				.from(schema.session)
				.where(eq(schema.session.userId, rejectedUserId)),
		).toHaveLength(0);
		expect(
			await db
				.select()
				.from(schema.account)
				.where(eq(schema.account.userId, rejectedUserId)),
		).toHaveLength(0);
		expect(
			await db
				.select({ isPersonal: schema.organization.isPersonal })
				.from(schema.member)
				.innerJoin(
					schema.organization,
					eq(schema.member.organizationId, schema.organization.id),
				)
				.where(eq(schema.member.userId, ownerId ?? "")),
		).toEqual([{ isPersonal: true }]);
		for (const email of [first.email, second.email]) {
			const returning = await start({ sub: first.sub, email });
			const response = await callback(returning, { instance: secondAuth });
			expect(response.headers.get("location")).toBe(`${BASE_URL}/complete`);
			expect((await sessionFor(response))?.user.id).toBe(ownerId);
		}
	});

	test("an account insert conflict rolls back the identity claim before a later owner login", async () => {
		const flow = await start();
		const ownerId = generateId();
		const ownerEmail = `${ownerId}@example.test`;
		await db.insert(schema.user).values({
			id: ownerId,
			email: ownerEmail,
			name: "Existing account without a mirror",
			emailVerified: true,
		});
		const accountId = generateId();
		await db.insert(schema.account).values({
			id: accountId,
			userId: ownerId,
			providerId: "gitcafe",
			accountId: flow.sub,
		});
		const adapter = (await auth.$context).internalAdapter;
		/** A stale lookup forces the unique-index conflict after the identity insert. */
		const lookup = spyOn(
			adapter,
			"findAccountOwnerByKey",
		).mockResolvedValueOnce(null);
		let response: Response;
		try {
			response = await callback(flow);
		} finally {
			lookup.mockRestore();
		}
		expect(response.headers.get("location")).toContain("error=");
		expect(await sessionFor(response)).toBeNull();
		expect(
			await db
				.select()
				.from(schema.forgeIdentities)
				.where(eq(schema.forgeIdentities.externalId, flow.sub)),
		).toHaveLength(0);
		expect(
			await db
				.select()
				.from(schema.account)
				.where(eq(schema.account.accountId, flow.sub)),
		).toMatchObject([{ id: accountId, userId: ownerId }]);
		const returning = await start({ sub: flow.sub, email: ownerEmail });
		expect((await sessionFor(await callback(returning)))?.user.id).toBe(
			ownerId,
		);
		expect(
			await db
				.select()
				.from(schema.forgeIdentities)
				.where(eq(schema.forgeIdentities.externalId, flow.sub)),
		).toMatchObject([{ userId: ownerId }]);
	});

	for (const [name, options] of Object.entries<FlowOptions>({
		"wrong signed issuer": { claims: { iss: "https://open-git.com" } },
		"wrong audience": { claims: { aud: "another-client" } },
		"ambiguous audience": { claims: { aud: [CLIENT_ID, "another-client"] } },
		"wrong authorized party": { claims: { azp: "another-client" } },
		"wrong nonce": { claims: { nonce: "another-request" } },
		"wrong access-token hash": { claims: { at_hash: "another-token" } },
		"unverified email": { claims: { email_verified: false } },
		"string verified email": { claims: { email_verified: "true" } },
		"malformed email": { claims: { email: "invalid" } },
		"empty handle": { claims: { preferred_username: "" } },
		"empty subject": { claims: { sub: "" } },
		"numeric subject": { claims: { sub: 42 } },
		"ID-token omission": { omitIdToken: true },
		"invalid signature": { signingKey: otherKey },
		"wrong algorithm": { algorithm: "HS256" },
		"expired token": { claims: { exp: Math.floor(Date.now() / 1000) - 120 } },
		"future issued-at": {
			claims: { iat: Math.floor(Date.now() / 1000) + 120 },
		},
	})) {
		test(`rejects ${name} without account or session creation`, async () => {
			const flow = await start(options);
			await expectRejected(flow, await callback(flow));
		});
	}

	for (const claim of [
		"iss",
		"sub",
		"aud",
		"iat",
		"exp",
		"nonce",
		"at_hash",
		"email_verified",
		"email",
		"preferred_username",
	] as const) {
		test(`rejects missing ${claim}`, async () => {
			const flow = await start({ omitClaims: [claim] });
			await expectRejected(flow, await callback(flow));
		});
	}

	test("valid signed claims cannot bypass a missing or expired server nonce record", async () => {
		for (const expired of [false, true]) {
			const flow = await start();
			const where = eq(
				schema.verification.identifier,
				`gitcafe-oidc-nonce:${flow.url.searchParams.get("nonce")}`,
			);
			if (expired) {
				await db
					.update(schema.verification)
					.set({ expiresAt: new Date(0) })
					.where(where);
			} else {
				await db.delete(schema.verification).where(where);
			}
			await expectRejected(flow, await callback(flow));
		}
	});

	test("an identity already owned by another local user cannot be reassigned", async () => {
		const flow = await start();
		const ownerId = generateId();
		await db.insert(schema.user).values({
			id: ownerId,
			email: `${ownerId}@example.test`,
			name: "Existing identity owner",
		});
		await db.insert(schema.forgeIdentities).values({
			id: generateId(),
			userId: ownerId,
			forge: "gitcafe",
			externalId: flow.sub,
			username: "original-owner-handle",
		});
		const response = await callback(flow);
		await expectRejected(flow, response);
		const identities = await db
			.select()
			.from(schema.forgeIdentities)
			.where(eq(schema.forgeIdentities.externalId, flow.sub));
		expect(identities).toHaveLength(1);
		expect(identities[0]).toMatchObject({
			userId: ownerId,
			username: "original-owner-handle",
		});
	});

	test("handle rename updates the same identity and keeps the same local user", async () => {
		const firstFlow = await start({ handle: "old-handle" });
		const first = await sessionFor(await callback(firstFlow));
		const renamedFlow = await start({
			sub: firstFlow.sub,
			email: firstFlow.email,
			handle: "renamed-handle",
		});
		const renamed = await sessionFor(await callback(renamedFlow));
		expect(renamed?.user.id).toBe(first?.user.id);
		const identities = await db
			.select()
			.from(schema.forgeIdentities)
			.where(eq(schema.forgeIdentities.externalId, firstFlow.sub));
		expect(identities).toHaveLength(1);
		expect(identities[0]?.username).toBe("renamed-handle");
	});

	test("same verified email cannot implicitly bind a different GitCafe subject", async () => {
		const ownerFlow = await start();
		const owner = await sessionFor(await callback(ownerFlow));
		const stranger = await start({ email: ownerFlow.email });
		await expectRejected(stranger, await callback(stranger));
		const accounts = await db
			.select()
			.from(schema.account)
			.where(eq(schema.account.userId, owner?.user.id ?? ""));
		expect(accounts).toHaveLength(1);
		expect(accounts[0]?.accountId).toBe(ownerFlow.sub);
	});

	test("same email on an existing local account cannot acquire a GitCafe identity", async () => {
		const userId = generateId();
		const email = `${userId}@example.test`;
		await db.insert(schema.user).values({
			id: userId,
			name: "Existing local account",
			email,
			emailVerified: true,
		});
		const flow = await start({ email });
		await expectRejected(flow, await callback(flow));
	});

	test("another trusted provider cannot implicitly bind to a GitCafe user by email", async () => {
		const ownerFlow = await start();
		const owner = await sessionFor(await callback(ownerFlow));
		const context = await auth.$context;
		const provider: OAuthProvider = {
			id: "github",
			name: "Trusted-provider binding test",
			accountSubject: () => generateId(),
			createAuthorizationURL: (data) =>
				createAuthorizationURL({
					id: "github",
					options: { clientId: CLIENT_ID },
					authorizationEndpoint: "https://github.com/login/oauth/authorize",
					state: data.state,
					codeVerifier: data.codeVerifier,
					redirectURI: data.redirectURI,
				}),
			validateAuthorizationCode: async () => ({ accessToken: generateId() }),
			getUserInfo: async () => ({
				user: {
					email: ownerFlow.email,
					name: "Other provider identity",
					emailVerified: true,
				},
				data: {},
			}),
		};
		context.socialProviders.push(provider);
		try {
			const flow = await start({}, { provider: "github" });
			const url = new URL(`${BASE_URL}/api/auth/callback/github`);
			url.searchParams.set("code", flow.code);
			url.searchParams.set("state", flow.url.searchParams.get("state") ?? "");
			const response = await auth.handler(
				new Request(url.toString(), { headers: { cookie: flow.cookie } }),
			);
			expect(response.headers.get("location")).toContain(
				"gitcafe_account_linking_disabled",
			);
			expect(await sessionFor(response)).toBeNull();
			const accounts = await db
				.select()
				.from(schema.account)
				.where(eq(schema.account.userId, owner?.user.id ?? ""));
			expect(accounts).toHaveLength(1);
			expect(accounts[0]?.providerId).toBe("gitcafe");
		} finally {
			context.socialProviders.splice(
				context.socialProviders.indexOf(provider),
				1,
			);
		}
	});

	test("a returning subject cannot switch users through another user's verified email", async () => {
		const ownerFlow = await start();
		const owner = await sessionFor(await callback(ownerFlow));
		const otherUserId = generateId();
		const otherEmail = `${otherUserId}@example.test`;
		await db.insert(schema.user).values({
			id: otherUserId,
			email: otherEmail,
			name: "Other local account",
			emailVerified: true,
		});
		const flow = await start({ sub: ownerFlow.sub, email: otherEmail });
		const returning = await sessionFor(await callback(flow));
		expect(returning?.user.id).toBe(owner?.user.id);
		expect(returning?.user.id).not.toBe(otherUserId);
		expect(returning?.user.email).toBe(ownerFlow.email);
	});

	test("direct ID-token linking from another provider cannot bypass the account-write guard", async () => {
		const ownerFlow = await start();
		const ownerResponse = await callback(ownerFlow);
		const owner = await sessionFor(ownerResponse);
		const context = await auth.$context;
		const otherSubject = generateId();
		/** This test verifier isolates the library's direct-link branch from provider cryptography. */
		const provider: OAuthProvider = {
			id: "opengit",
			name: "Direct-link protocol test",
			idToken: { verify: async () => true },
			accountSubject: () => otherSubject,
			createAuthorizationURL: () => {
				throw new Error("Unexpected redirect path");
			},
			validateAuthorizationCode: async () => {
				throw new Error("Unexpected exchange path");
			},
			getUserInfo: async () => ({
				user: {
					email: ownerFlow.email,
					emailVerified: true,
					name: "Direct-link identity",
				},
				data: {},
			}),
		};
		context.socialProviders.push(provider);
		try {
			const response = await post(
				"/link-social",
				{ provider: "opengit", idToken: { token: generateId() } },
				cookieHeader(ownerResponse),
			);
			expect(response.ok).toBe(false);
			const accounts = await db
				.select()
				.from(schema.account)
				.where(eq(schema.account.userId, owner?.user.id ?? ""));
			expect(accounts).toHaveLength(1);
			expect(accounts[0]?.providerId).toBe("gitcafe");
		} finally {
			context.socialProviders.splice(
				context.socialProviders.indexOf(provider),
				1,
			);
		}
	});

	test("explicit linking to another signed-in user is rejected even for equal emails", async () => {
		const ownerFlow = await start();
		const ownerResponse = await callback(ownerFlow);
		const flow = await start(
			{ email: ownerFlow.email },
			{ provider: "gitcafe" },
		);
		const link = await post(
			"/link-social",
			{ provider: "gitcafe", callbackURL: `${BASE_URL}/complete` },
			cookieHeader(ownerResponse),
		);
		expect(link.ok).toBe(true);
		const body = gitCafeAuthorizationResponseSchema.parse(await link.json());
		flow.url = new URL(body.url);
		flow.cookie = cookieHeader(link);
		await expectRejected(flow, await callback(flow));
	});

	test("a returning subject with an unverified email cannot reuse local verification", async () => {
		const firstFlow = await start();
		const first = await callback(firstFlow);
		expect(await sessionFor(first)).not.toBeNull();
		const flow = await start({
			sub: firstFlow.sub,
			email: firstFlow.email,
			claims: { email_verified: false },
		});
		const response = await callback(flow);
		expect(response.headers.get("location")).toContain("error=");
		expect(await sessionFor(response)).toBeNull();
	});

	test("raw ID-token sign-in cannot bypass browser state and nonce", async () => {
		const flow = await start();
		const response = await post("/sign-in/social", {
			provider: "gitcafe",
			idToken: { token: idToken(flow, generateId()) },
		});
		expect(response.ok).toBe(false);
		expect(await sessionFor(response)).toBeNull();
	});

	for (const providerId of ["github", "opengit"] as const) {
		for (const gitCafeEnabled of [false, true]) {
			test(`${providerId} signup and returning login retain tokens with GitCafe ${gitCafeEnabled ? "enabled" : "disabled"}`, async () => {
				const instance = gitCafeEnabled ? auth : disabledAuth;
				const context = await instance.$context;
				const subject = generateId();
				const email = `${subject}@example.test`;
				const tokens = {
					accessToken: generateId(),
					refreshToken: generateId(),
					idToken: generateId(),
				};
				/** Isolate shared account persistence from each legacy provider's transport. */
				const provider: OAuthProvider = {
					id: providerId,
					name: "Existing provider persistence test",
					accountSubject: () => subject,
					createAuthorizationURL: (data) =>
						createAuthorizationURL({
							id: providerId,
							options: { clientId: CLIENT_ID },
							authorizationEndpoint: "https://provider.example.test/authorize",
							state: data.state,
							codeVerifier: data.codeVerifier,
							redirectURI: data.redirectURI,
						}),
					validateAuthorizationCode: async () => tokens,
					getUserInfo: async () => ({
						user: { email, emailVerified: true, name: "Legacy provider owner" },
						data: {},
					}),
				};
				context.socialProviders.push(provider);
				let ownerId: string | undefined;
				try {
					for (let login = 0; login < 2; login++) {
						const flow = await start(
							{},
							{ provider: providerId },
							undefined,
							instance,
						);
						const url = new URL(`${BASE_URL}/api/auth/callback/${providerId}`);
						url.searchParams.set("code", flow.code);
						url.searchParams.set(
							"state",
							flow.url.searchParams.get("state") ?? "",
						);
						const response = await instance.handler(
							new Request(url.toString(), { headers: { cookie: flow.cookie } }),
						);
						expect(response.headers.get("location")).toBe(
							`${BASE_URL}/complete`,
						);
						const session = await sessionFor(response, instance);
						expect(session?.user.email).toBe(email);
						if (login === 0) {
							ownerId = session?.user.id;
						} else {
							expect(session?.user.id).toBe(ownerId);
						}
					}
				} finally {
					context.socialProviders.splice(
						context.socialProviders.indexOf(provider),
						1,
					);
				}
				expect(
					await db
						.select()
						.from(schema.account)
						.where(eq(schema.account.accountId, subject)),
				).toMatchObject([{ providerId, userId: ownerId, ...tokens }]);
				expect(
					await db
						.select()
						.from(schema.forgeIdentities)
						.where(eq(schema.forgeIdentities.externalId, subject)),
				).toMatchObject([{ forge: providerId, userId: ownerId }]);
			});
		}
	}
});
