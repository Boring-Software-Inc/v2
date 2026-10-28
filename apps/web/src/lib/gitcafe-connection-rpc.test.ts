import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** Synthetic service outputs exercise serialization; they are not GitCafe provider evidence. */
test("GitCafe RPC handlers validate every response branch and refuse malformed service output", () => {
	const result = spawnSync(
		process.execPath,
		[
			"--no-env-file",
			"--eval",
			`
		import assert from "node:assert/strict";
		import { mock } from "bun:test";
		mock.module("@tanstack/react-start", () => ({
			createServerFn: () => {
				const builder = {
					middleware: () => builder,
					inputValidator: () => builder,
					handler: (handler) => handler,
				};
				return builder;
			},
		}));
		mock.module("#/lib/server/gated-server-fn", () => ({ accessGuardMiddleware: {} }));
		mock.module("#/lib/server/org-guard", () => ({ orgPermissionMiddleware: () => ({}) }));
		mock.module("#/lib/server/staff-guard", () => ({ sameOriginMiddleware: {} }));
		let session = null;
		let orgs = [];
		mock.module("#/lib/server/auth", () => ({ getAuth: () => ({ api: { getSession: async () => session } }) }));
		mock.module("@tanstack/start-storage-context", () => ({ getStartContext: () => ({ request: new Request("https://tripwire.test") }) }));
		mock.module("#/lib/server/db", () => ({ getDb: () => ({ db: {} }) }));
		mock.module("@tripwire/db", () => ({ orgServices: { listUserOrgs: async () => orgs } }));
		mock.module("@tripwire/auth/org-gate", () => ({ memberPermissions: async (_db, input) => input.orgId === "read-only" ? [] : ["connections:manage"] }));
		mock.module("#/lib/server/install-state", () => ({ verifyInstallState: () => null }));
		let confirmation;
		let status;
		let start;
		mock.module("#/lib/server/gitcafe-connection", () => ({
			confirmGitCafeGrant: async () => confirmation,
			readGitCafeConnectionStatus: async () => status,
			startGitCafeGrant: async () => start,
		}));
		const fns = await import("#/lib/gitcafe-connection.functions");
		const args = { data: { installationId: "synthetic", orgId: "org-team" }, context: { org: { id: "org-team" } } };
		assert.deepEqual(await fns.getGitCafeSetupContext(args), { orgs: [], suggestedOrg: null });
		session = { user: { id: "user" } };
		orgs = [{ id: "org-team", slug: "team", name: "Team", accessToken: "private" }, { id: "read-only", slug: "other-team", name: "Other" }];
		assert.deepEqual(await fns.getGitCafeSetupContext(args), { orgs: [{ id: "org-team", slug: "team", name: "Team" }], suggestedOrg: "team" });
		for (const invalid of [{ slug: "../unsafe" }, { id: "" }, { name: 42 }]) {
			orgs = [{ id: "org-team", slug: "team", name: "Team", ...invalid }];
			await assert.rejects(() => fns.getGitCafeSetupContext(args));
		}
		const { gitCafeConnectionRefusalSchema } = await import("@tripwire/contracts");
		for (const reason of [...gitCafeConnectionRefusalSchema.options, "unavailable", "refused", "retry"]) {
			confirmation = { ok: false, reason };
			assert.deepEqual(await fns.confirmGitCafeConnection(args), confirmation);
		}
		confirmation = { ok: true, jobId: "01900000-0000-7000-8000-000000000001" };
		assert.deepEqual(await fns.confirmGitCafeConnection(args), confirmation);
		for (const invalid of [
			{ ok: true, jobId: "not-a-job" },
			{ ok: true, jobId: confirmation.jobId, accessToken: "private" },
			{ ok: false, reason: "retry", proofHandle: "a".repeat(48) },
			{ ok: false, reason: "unknown" },
		]) {
			confirmation = invalid;
			await assert.rejects(() => fns.confirmGitCafeConnection(args));
		}
		for (const value of [{ status: "retry" }, { status: "pending" }, { status: "connected", repoCount: 1 }, { status: "refused", reason: "queue-unavailable" }]) {
			status = value;
			assert.deepEqual(await fns.getGitCafeConnectionStatus(args), value);
		}
		for (const invalid of [{ status: "connected", repoCount: -1 }, { status: "retry", accessToken: "private" }]) {
			status = invalid;
			await assert.rejects(() => fns.getGitCafeConnectionStatus(args));
		}
		start = { url: "https://git.cafe/oauth/authorize?state=synthetic" };
		assert.deepEqual(await fns.startGitCafeConnection(args), start);
		start = { url: "not-a-url" };
		await assert.rejects(() => fns.startGitCafeConnection(args));
		start = { url: "https://git.cafe/oauth/authorize", accessToken: "private" };
		assert.deepEqual(await fns.startGitCafeConnection(args), { url: start.url });
	`,
		],
		{
			cwd: fileURLToPath(new URL("../../", import.meta.url)),
			env: { NODE_ENV: "test", PATH: process.env.PATH },
			encoding: "utf8",
		},
	);
	expect(result.stderr).toBe("");
	expect(result.status).toBe(0);
});
