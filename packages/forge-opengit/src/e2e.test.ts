import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createSign, createVerify, generateKeyPairSync } from "node:crypto";
import { CHECK_NAME, type JsonValue } from "@tripwire/contracts";
import type { ForgeAction, ForgeAdapter } from "@tripwire/forge";
import { z } from "zod";
import { createOpenGitAdapter } from "./adapter.ts";
import { OpenGitTokenCache } from "./client/auth.ts";
import { signWebhookBody } from "./webhook/verify.ts";

/**
 * End-to-end against a STUB open-git, in process.
 *
 * This is not the live harness (`scripts/e2e/opengit.ts`), which drives real
 * pull requests and needs credentials, a worker and a tunnel. This is the
 * furthest an OFFLINE test can go: a real HTTP server implementing open-git's
 * bot endpoints, which verifies the app JWT before minting, then requires the
 * minted installation token on every later call.
 *
 * So the whole credential chain runs for real: private key → app JWT →
 * server-side verification → installation token → bearer on the gate and the
 * comment. Only Postgres and the worker's job plumbing are out of frame.
 *
 * The stub verifies the SIGNATURE with real crypto and then checks the same
 * three things open-git checks — RS256, `iss` = bot id, and a 10-minute
 * maxTokenAge from `iat`. It is deliberately STRICTER on one point: a future
 * `iat` is refused outright, because a stub that is more permissive than the
 * real server would accept tokens production rejects, which is the failure this
 * test exists to catch.
 */

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
	modulusLength: 2048,
	privateKeyEncoding: { type: "pkcs8", format: "pem" },
	publicKeyEncoding: { type: "spki", format: "pem" },
});

const BOT_ID = "bot_tripwire";
const INSTALLATION_ID = "inst_42";
const INSTALLATION_TOKEN = "ogi_installation_secret";
const WEBHOOK_SECRET = "opengit-webhook-secret";
const REPO = "acme/widgets";
const SHA = "d".repeat(40);

interface ServerCall {
	path: string;
	method: string;
	authorization: string | null;
}

const calls: ServerCall[] = [];
let server: ReturnType<typeof Bun.serve>;
let adapter: ForgeAdapter;

const appJwtHeaderSchema = z.object({ alg: z.literal("RS256") });
const appJwtClaimsSchema = z.object({
	iss: z.literal(BOT_ID),
	iat: z.number(),
});

/** open-git's `verifyBotAppJwt` contract, checked the way it checks it. */
function appJwtIsValid(token: string, now = Date.now()): boolean {
	const [header, payload, signature] = token.split(".");
	if (!(header && payload && signature)) {
		return false;
	}
	const verified = createVerify("RSA-SHA256")
		.update(`${header}.${payload}`)
		.verify(publicKey, Buffer.from(signature, "base64url"));
	if (!verified) {
		return false;
	}
	const parsedHeader = appJwtHeaderSchema.safeParse(
		JSON.parse(Buffer.from(header, "base64url").toString("utf8")),
	);
	const claims = appJwtClaimsSchema.safeParse(
		JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
	);
	const seconds = Math.floor(now / 1000);
	return (
		parsedHeader.success &&
		claims.success &&
		claims.data.iat <= seconds &&
		seconds - claims.data.iat <= 600
	);
}

beforeAll(() => {
	server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(request) {
			const url = new URL(request.url);
			const authorization = request.headers.get("authorization");
			await request.text();
			calls.push({ path: url.pathname, method: request.method, authorization });
			const bearer = authorization?.replace("Bearer ", "") ?? "";

			// Minting is authenticated by the APP JWT.
			if (url.pathname.endsWith("/access_tokens")) {
				return appJwtIsValid(bearer)
					? Response.json({
							token: INSTALLATION_TOKEN,
							expires_at: new Date(Date.now() + 3_600_000).toISOString(),
							permissions: ["checks:write", "pull_requests:write"],
						})
					: Response.json({ error: "Bad app JWT." }, { status: 401 });
			}
			// Everything else is authenticated by the INSTALLATION token.
			if (bearer !== INSTALLATION_TOKEN) {
				return Response.json({ error: "Unauthorized." }, { status: 401 });
			}
			if (url.pathname.endsWith("/checks")) {
				return Response.json(
					{ id: "check_1", name: CHECK_NAME },
					{ status: 201 },
				);
			}
			if (url.pathname.endsWith("/comments")) {
				return Response.json(
					{ id: "comment_1", author: "bot" },
					{ status: 201 },
				);
			}
			return Response.json({ error: "Not found." }, { status: 404 });
		},
	});

	const apiBase = `http://127.0.0.1:${server.port}`;
	const tokens = new OpenGitTokenCache({ botId: BOT_ID, privateKey }, apiBase);
	adapter = createOpenGitAdapter({
		apiBase,
		// The worker resolves repo → installation through the database; here the
		// repo is known to belong to one installation.
		tokenFor: () => tokens.getToken(INSTALLATION_ID),
	});
});

afterAll(() => {
	server.stop(true);
});

const delivery = (eventName: string, payload: JsonValue) => {
	const body = JSON.stringify(payload);
	return {
		deliveryId: `d-${eventName}`,
		eventName,
		body,
		signature: signWebhookBody(body, WEBHOOK_SECRET),
	};
};

const PR = {
	id: "pr_1",
	number: 7,
	title: "add a thing",
	head_sha: SHA,
	author: "newcontributor",
};
const REPOSITORY = { id: "repo_1", name: "widgets", owner: "acme" };

describe("local app JWT validation", () => {
	const now = Date.UTC(2026, 7, 19);
	const seconds = now / 1000;

	function signedToken(header: JsonValue, claims: JsonValue): string {
		const input = [header, claims]
			.map((value) => Buffer.from(JSON.stringify(value)).toString("base64url"))
			.join(".");
		const signature = createSign("RSA-SHA256")
			.update(input)
			.sign(privateKey)
			.toString("base64url");
		return `${input}.${signature}`;
	}

	test.each([
		seconds,
		seconds - 600,
	])("accepts iat %p at the age bounds", (iat) => {
		expect(
			appJwtIsValid(signedToken({ alg: "RS256" }, { iss: BOT_ID, iat }), now),
		).toBe(true);
	});

	const invalidClaims: JsonValue[] = [
		{ iss: BOT_ID, iat: seconds + 1 },
		{ iss: BOT_ID, iat: seconds - 601 },
		{ iss: BOT_ID, iat: String(seconds) },
		{ iss: BOT_ID, iat: null },
		{ iss: BOT_ID },
		{ iss: "another-bot", iat: seconds },
	];

	test.each(
		invalidClaims,
	)("rejects signed claims outside the bot contract %p", (claims) => {
		expect(appJwtIsValid(signedToken({ alg: "RS256" }, claims), now)).toBe(
			false,
		);
	});

	test("rejects a signed header declaring another algorithm", () => {
		expect(
			appJwtIsValid(
				signedToken({ alg: "HS256" }, { iss: BOT_ID, iat: seconds }),
				now,
			),
		).toBe(false);
	});

	test("rejects missing JWT segments", () => {
		expect(appJwtIsValid("header.payload", now)).toBe(false);
	});
});

describe("inbound — a signed delivery becomes an event", () => {
	test("a tampered body is rejected before anything is parsed", () => {
		const body = JSON.stringify({ action: "comment" });
		expect(
			adapter.verifyWebhook(
				{
					deliveryId: "d1",
					eventName: "pull_request.comment",
					body,
					// Signed over a DIFFERENT body: one trailing space.
					signature: signWebhookBody(`${body} `, WEBHOOK_SECRET),
				},
				WEBHOOK_SECRET,
			),
		).toBe(false);
	});

	test("a real pull request verifies and normalizes", () => {
		const event = delivery("pull_request.opened", {
			installation_id: INSTALLATION_ID,
			repository: REPOSITORY,
			pull_request: PR,
		});
		expect(adapter.verifyWebhook(event, WEBHOOK_SECRET)).toBe(true);
		const normalized = adapter.normalizeWebhook(
			event,
			"2026-08-19T00:00:00.000Z",
		);
		expect(normalized?.kind).toBe("change-request.opened");
		expect(normalized?.forge).toBe("opengit");
		expect(normalized && "repo" in normalized && normalized.repo.fullName).toBe(
			REPO,
		);
		expect(normalized?.actor.login).toBe("newcontributor");
	});

	test("a comment verifies and normalizes, naming its change request", () => {
		const event = delivery("pull_request.comment", {
			installation_id: INSTALLATION_ID,
			repository: REPOSITORY,
			pull_request: PR,
			comment: { id: "c_1", author: "newcontributor", body: "ping" },
		});
		const normalized = adapter.normalizeWebhook(
			event,
			"2026-08-19T00:00:00.000Z",
		);
		expect(normalized?.kind).toBe("comment.created");
		// The subject a comment-triggered run is addressed by.
		expect(
			normalized && "comment" in normalized && normalized.comment.subjectNumber,
		).toBe(7);
	});

	test("a pull request with no author is not ingested", () => {
		const { author, ...anonymous } = PR;
		expect(author).toBe("newcontributor");
		expect(
			adapter.normalizeWebhook(
				delivery("pull_request.opened", {
					installation_id: INSTALLATION_ID,
					repository: REPOSITORY,
					pull_request: anonymous,
				}),
				"2026-08-19T00:00:00.000Z",
			),
		).toBeNull();
	});
});

describe("outbound — the credential chain, end to end", () => {
	test("the check is written with a token minted by the app jwt", async () => {
		calls.length = 0;
		const result = await adapter.execute({
			kind: "set-check",
			repoFullName: REPO,
			check: {
				sha: SHA,
				conclusion: "failure",
				summary: "blocked",
				detailsUrl: "https://tripwire.sh/runs/1",
			},
		});
		expect(result).toMatchObject({ externalId: "check_1" });

		// Two calls, in order: mint, then act.
		expect(calls.map((call) => call.path.split("/").pop())).toEqual([
			"access_tokens",
			"checks",
		]);
		// The mint presented a JWT the server verified; the check presented the
		// token that mint returned.
		expect(calls[0]?.authorization?.startsWith("Bearer ey")).toBe(true);
		expect(calls[1]?.authorization).toBe(`Bearer ${INSTALLATION_TOKEN}`);
	});

	test("the token is reused, not re-minted per action", async () => {
		calls.length = 0;
		await adapter.execute({
			kind: "comment",
			repoFullName: REPO,
			number: 7,
			body: "**tripwire** blocked this",
			verdict: "block",
			previousVerdict: null,
		});
		// No second mint: the cache holds an unexpired token.
		expect(calls.map((call) => call.path.split("/").pop())).toEqual([
			"comments",
		]);
		expect(calls[0]?.authorization).toBe(`Bearer ${INSTALLATION_TOKEN}`);
	});

	test("a repeated verdict says nothing, and touches no endpoint", async () => {
		calls.length = 0;
		const result = await adapter.execute({
			kind: "comment",
			repoFullName: REPO,
			number: 7,
			body: "**tripwire** blocked this",
			verdict: "block",
			previousVerdict: "block",
		});
		expect(calls).toHaveLength(0);
		expect(result).toMatchObject({ externalId: null });
	});

	/**
	 * A wrong app JWT must fail at the MINT, not silently downgrade to an
	 * unauthenticated call. This is the check the stub exists for.
	 */
	test("a bot key the server does not know cannot mint", async () => {
		const other = generateKeyPairSync("rsa", {
			modulusLength: 2048,
			privateKeyEncoding: { type: "pkcs8", format: "pem" },
			publicKeyEncoding: { type: "spki", format: "pem" },
		});
		const apiBase = `http://127.0.0.1:${server.port}`;
		const tokens = new OpenGitTokenCache(
			{ botId: BOT_ID, privateKey: other.privateKey },
			apiBase,
		);
		await expect(tokens.getToken(INSTALLATION_ID)).rejects.toThrow(/401/);
	});
});

describe("what open-git cannot do, refused rather than faked", () => {
	const unsupportedActions = [
		{ kind: "block", repoFullName: REPO, number: 7, reason: "no" },
		{ kind: "label", repoFullName: REPO, number: 7, labels: ["x"] },
		{
			kind: "request-review",
			repoFullName: REPO,
			number: 7,
			reviewers: ["maintainer"],
			teamReviewers: [],
		},
	] satisfies ForgeAction[];

	test.each(unsupportedActions)("$kind reaches no endpoint", async (action) => {
		calls.length = 0;
		await expect(adapter.execute(action)).rejects.toThrow();
		expect(calls).toHaveLength(0);
	});

	test.each([
		{ method: "getDiff", call: () => adapter.getDiff(REPO, 7) },
		{ method: "getCommits", call: () => adapter.getCommits(REPO, 7) },
		{
			method: "readFile",
			call: () => adapter.readFile(REPO, "README.md", SHA),
		},
		{
			method: "getContributorProfile",
			call: () => adapter.getContributorProfile(REPO, "newcontributor"),
		},
	])("$method throws rather than reporting an empty read", ({ call }) => {
		expect(call).toThrow(/does not give Tripwire access/);
	});
});
