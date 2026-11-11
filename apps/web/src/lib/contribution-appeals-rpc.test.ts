import { expect, test } from "bun:test";

test("appeals accept pending contributors and reject banned, revoked, and impersonated sessions", async () => {
	const source = `
import { expect, mock } from "bun:test";
let current = { user: { id: "contributor" }, session: { id: "session" } };
let fence = { live: true, banned: false, impersonatedBy: null };
let reads = 0;
let writes = 0;
mock.module("@tanstack/react-start", () => ({
	createServerFn() {
		let validator;
		return {
			middleware() { return this; },
			inputValidator(next) { validator = next; return this; },
			handler(handler) {
				return (input) => handler({ data: validator.parse(input.data), context: {} });
			},
		};
	},
}));
mock.module("#/lib/server/auth", () => ({ getAuth: () => ({ api: { getSession: async () => current } }) }));
mock.module("@tanstack/start-storage-context", () => ({ getStartContext: () => ({ request: { headers: new Headers() } }) }));
mock.module("#/lib/server/staff-users", () => ({ fenceOf: async () => fence }));
mock.module("#/lib/server/staff-guard", () => ({ sameOriginMiddleware: {} }));
mock.module("#/lib/server/gated-server-fn", () => ({ accessGuardMiddleware: {} }));
mock.module("#/lib/server/org-guard", () => ({ orgPermissionMiddleware: () => ({}), resolveOrgRepo: async () => ({ id: "repo" }) }));
mock.module("#/lib/server/db", () => ({ getDb: () => ({ db: {} }) }));
mock.module("@tripwire/db", () => ({
	contributionAppealServices: {
		getOwnAppeal: async () => { reads++; return { status: null }; },
		submitAppeal: async () => { writes++; return { status: "pending" }; },
	},
}));
const { getContributionAppeal, submitContributionAppeal } = await import("./src/lib/contribution-appeals.functions.ts");
const runId = "019f54d3-0c13-7000-930a-dc97f87e1d5e";
expect(await getContributionAppeal({ data: { runId } })).toEqual({ state: "eligible", status: null });
expect(await submitContributionAppeal({ data: { runId, reason: "Review this decision" } })).toEqual({ status: "pending" });
expect(reads).toBe(1);
expect(writes).toBe(1);
for (const next of [
	{ live: true, banned: true, impersonatedBy: null },
	{ live: false, banned: false, impersonatedBy: null },
	{ live: true, banned: false, impersonatedBy: "admin" },
]) {
	fence = next;
	expect(await getContributionAppeal({ data: { runId } })).toEqual({ state: "signed-out" });
	expect(await submitContributionAppeal({ data: { runId, reason: "Review this decision" } })).toBeNull();
}
expect(reads).toBe(1);
expect(writes).toBe(1);
process.stdout.write("appeal-session-fence-pass");
`;
	const child = Bun.spawn([process.execPath, "-e", source], {
		cwd: new URL("../..", import.meta.url).pathname,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [out, err, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	expect({ exitCode, stderr: err }).toEqual({ exitCode: 0, stderr: "" });
	expect(out).toContain("appeal-session-fence-pass");
});
