import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import {
	installUrlFor,
	signInstallState,
	verifyInstallState,
} from "@tripwire/auth/install-state";
import { discoverServerFns } from "#/lib/server-fn-discovery";

describe("GitCafe connection authorization boundary", () => {
	test("GETs cannot claim; writes require connections:manage and a same-origin request", () => {
		const fns = discoverServerFns();
		for (const name of ["startGitCafeConnection", "confirmGitCafeConnection"]) {
			const fn = fns.find((entry) => entry.name === name);
			expect(fn?.method).toBe("POST");
			expect(fn?.permission).toBe("connections:manage");
			expect(fn?.sameOrigin).toBe(true);
		}
		const source = readFileSync(
			new URL("./gitcafe-connection.functions.ts", import.meta.url),
			"utf8",
		);
		const setupRead = source.slice(
			source.indexOf("export const getGitCafeSetupContext"),
			source.indexOf("export const startGitCafeConnection"),
		);
		expect(setupRead).not.toContain("consumeGitCafeConnectProof");
		expect(setupRead).not.toContain("enqueueGitCafeConnection");
	});
	test("install hints expire and carry forge/purpose, while GitHub hints still verify", () => {
		const secret = "test-install-state-secret";
		const legacy = signInstallState({ userId: "user", orgId: "org" }, secret);
		expect(verifyInstallState(legacy, secret)).toEqual({
			userId: "user",
			orgId: "org",
		});
		const hint = signInstallState(
			{ userId: "user", orgId: "org", forge: "gitcafe" },
			secret,
		);
		expect(verifyInstallState(hint, secret)).toMatchObject({
			userId: "user",
			orgId: "org",
			forge: "gitcafe",
			purpose: "gitcafe-install",
		});
		expect(verifyInstallState(hint, "wrong")).toBeNull();
		expect(verifyInstallState(`${hint}.extra`, secret)).toBeNull();
		expect(
			verifyInstallState(
				signInstallState(
					{
						userId: "user",
						orgId: "org",
						forge: "gitcafe",
						expiresAt: Date.now() - 1,
					},
					secret,
				),
				secret,
			),
		).toBeNull();
	});
	test("GitCafe installation URL uses only configured slug and bound state", () => {
		expect(
			installUrlFor("gitcafe", "hint.a+b", "github", "tripwire-test"),
		).toEqual({
			status: "ready",
			url: "https://git.cafe/apps/tripwire-test/install?state=hint.a%2Bb",
		});
		expect(installUrlFor("gitcafe", "hint", "github")).toEqual({
			status: "not-configured",
		});
		expect(installUrlFor("gitcafe", "hint", "github", "../evil")).toEqual({
			status: "not-configured",
		});
		expect(installUrlFor("github", "hint", "github")).toEqual({
			status: "ready",
			url: "https://github.com/apps/github/installations/new?state=hint",
		});
	});
	test("a valid signature cannot admit malformed or partial install bindings", () => {
		const secret = "test-install-state-secret";
		for (const malformed of [
			null,
			{ u: 1, o: "org" },
			{ u: "user", o: "" },
			{ u: "user", o: "org", f: "gitcafe" },
			{
				u: "user",
				o: "org",
				f: "gitcafe",
				p: "other-purpose",
				e: Date.now() + 60_000,
			},
			{
				u: "user",
				o: "org",
				f: "gitcafe",
				p: "gitcafe-install",
				e: Number.MAX_SAFE_INTEGER + 1,
			},
		]) {
			const payload = Buffer.from(JSON.stringify(malformed)).toString(
				"base64url",
			);
			const mac = createHmac("sha256", secret)
				.update(payload)
				.digest("base64url");
			expect(verifyInstallState(`${payload}.${mac}`, secret)).toBeNull();
		}
	});
	test("browser entry imports stay server-free and queue receives metadata only", () => {
		const server = readFileSync(
			new URL("./server/gitcafe-connection.ts", import.meta.url),
			"utf8",
		);
		const job = server.slice(
			server.indexOf("const job ="),
			server.indexOf("const result = await gitCafeConnectionServices.enqueue"),
		);
		expect(job).not.toContain("accessToken");
		expect(job).toContain("proof.subject");
		expect(job).toContain("proof.actorId");
		expect(server.indexOf('await read("/api/oauth/userinfo")')).toBeLessThan(
			server.indexOf("const job ="),
		);
		expect(server.indexOf('await read("/api/auth/principal")')).toBeLessThan(
			server.indexOf("const job ="),
		);
		const browser = readFileSync(
			new URL(
				"../../../../packages/utils/src/forge-sign-in.ts",
				import.meta.url,
			),
			"utf8",
		);
		expect(browser).not.toContain("node:");
		expect(browser).not.toContain("./index");
	});
});
