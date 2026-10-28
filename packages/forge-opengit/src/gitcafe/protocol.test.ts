import { describe, expect, test } from "bun:test";
import { createHmac, generateKeyPairSync, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import {
	gitCafePublicBlobSchema,
	gitCafePublicProfileSchema,
	gitCafePublicPullSchema,
	gitCafePublicRepositorySchema,
} from "@tripwire/contracts";
import {
	createGitCafeInstallationRequest,
	verifyGitCafeWebhook,
} from "@tripwire/forge-opengit/gitcafe";

describe("GitCafe protocol primitives", () => {
	const { privateKey, publicKey } = generateKeyPairSync("ec", {
		namedCurve: "prime256v1",
	});
	const credentials = {
		appId: "app_test",
		keyId: "key-1",
		privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
	};
	test("signs a fresh exact-audience assertion in each transport", () => {
		const lookup = createGitCafeInstallationRequest(
			credentials,
			"install_1",
			"lookup",
			1_700_000_000_000,
		);
		const mint = createGitCafeInstallationRequest(
			credentials,
			"install_1",
			"mint",
			1_700_000_000_000,
		);
		const bearer = new Headers(lookup.init.headers).get("authorization");
		const body = JSON.parse(String(mint.init.body));
		const jwt = bearer?.slice(7);
		expect(jwt).toBeDefined();
		if (!jwt) throw new Error("Missing assertion");
		const [header, payload, signature] = jwt.split(".");
		if (!header || !payload || !signature)
			throw new Error("Malformed assertion");
		expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({
			alg: "ES256",
			typ: "JWT",
			kid: "key-1",
		});
		const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
		expect(claims).toMatchObject({
			iss: "app_test",
			sub: "app_test",
			aud: lookup.url,
			iat: 1_700_000_000,
			exp: 1_700_000_300,
		});
		expect(claims.jti).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
		);
		expect(
			verify(
				"sha256",
				Buffer.from(`${header}.${payload}`),
				{ key: publicKey, dsaEncoding: "ieee-p1363" },
				Buffer.from(signature, "base64url"),
			),
		).toBe(true);
		const mintClaims = JSON.parse(
			Buffer.from(body.client_assertion.split(".")[1], "base64url").toString(),
		);
		expect(mintClaims.aud).toBe(mint.url);
		expect(mintClaims.jti).not.toBe(claims.jti);
		expect(body.client_assertion_type).toBe(
			"urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
		);
		expect(new Headers(mint.init.headers).has("authorization")).toBe(false);
		expect(() =>
			createGitCafeInstallationRequest(credentials, "../evil", "mint"),
		).toThrow();
		const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 })
			.privateKey.export({ type: "pkcs8", format: "pem" })
			.toString();
		expect(() =>
			createGitCafeInstallationRequest(
				{ ...credentials, privateKey: rsa },
				"install_1",
				"mint",
			),
		).toThrow();
	});
	test("verifies raw bytes, freshness and the selected rotation key", () => {
		const body = Buffer.from('{"x": 1}\n');
		const timestamp = "1700000000";
		const signature = `sha256=${createHmac("sha256", "new-secret").update(`${timestamp}.`).update(body).digest("hex")}`;
		const input = {
			body,
			timestamp,
			signature,
			keyVersion: "2",
			secrets: new Map([
				["1", "old-secret"],
				["2", "new-secret"],
			]),
			now: 1_700_000_000_000,
			maxAgeSeconds: 300,
			maxFutureSeconds: 30,
		};
		expect(verifyGitCafeWebhook(input)).toBe(true);
		expect(verifyGitCafeWebhook({ ...input, keyVersion: "1" })).toBe(false);
		expect(verifyGitCafeWebhook({ ...input, keyVersion: "3" })).toBe(false);
		expect(
			verifyGitCafeWebhook({ ...input, body: Buffer.from('{"x":1}') }),
		).toBe(false);
		expect(verifyGitCafeWebhook({ ...input, timestamp: "01700000000" })).toBe(
			false,
		);
		expect(
			verifyGitCafeWebhook({ ...input, signature: signature.toUpperCase() }),
		).toBe(false);
		expect(verifyGitCafeWebhook({ ...input, now: input.now + 301_000 })).toBe(
			false,
		);
		expect(verifyGitCafeWebhook({ ...input, now: input.now - 31_000 })).toBe(
			false,
		);
	});
	test("parses the captured public repository response", () => {
		const raw: unknown = JSON.parse(
			readFileSync(
				new URL("../../fixtures/gitcafe-repository.json", import.meta.url),
				"utf8",
			),
		);
		expect(gitCafePublicRepositorySchema.parse(raw)).toMatchObject({
			owner: "versecafe",
			name: "ashlar",
			visibility: "public",
		});
		for (const [name, schema] of [
			["profile", gitCafePublicProfileSchema],
			["pull", gitCafePublicPullSchema],
			["source", gitCafePublicBlobSchema],
		] as const) {
			const value: unknown = JSON.parse(
				readFileSync(
					new URL(`../../fixtures/gitcafe-${name}.json`, import.meta.url),
					"utf8",
				),
			);
			expect(schema.safeParse(value).success).toBe(true);
		}
	});
});
