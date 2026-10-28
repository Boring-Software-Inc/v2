import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ORG_PERMISSIONS, roleHasPermission } from "@tripwire/auth/org-access";
import { SERVER_FN_CLASSIFICATION } from "./server-fn-classification.ts";
import { discoverServerFns, ORG_SHELL } from "./server-fn-discovery.ts";

/**
 * Structural authz boundary (invariant 3). Server functions are HTTP endpoints;
 * every one that returns product data MUST be access-gated by chaining
 * `.middleware([accessGuardMiddleware])` on a literal `createServerFn` (see
 * gated-server-fn.ts for WHY it must be inline, not a wrapper). This test scans
 * the source and fails if a server function omits that middleware without being
 * on the explicit public allowlist — so the NEXT server function someone adds
 * can't silently ship ungated. Deny by default, same posture as the CI check.
 */

// Intentionally reachable without approval. Keep this list SMALL and justified.
const PUBLIC_ALLOWLIST = new Set([
	"getSessionInfo", // session/status — feeds the gate, queue screen, unauth
	"getCurrentUser", // caller's OWN identity (name/login/avatar); no product data
	/** The signed-out login page needs provider IDs, never auth configuration. */
	"getSignInProviderIds",
	"getRun", // the unlisted-public run page — readable without a session by design
	"getWebviewHost", // echoes the caller's own user-agent; /login is signed-out
	"redeemOrgInvite", // §6: redemption APPROVES pending users — gating it deadlocks
	"stopImpersonating",
	"recordDatabuddyAnonId",
]);

const MEMBER_MUTATION_ALLOWLIST = new Set(["leaveOrg", "rememberActiveOrg"]);

describe("server-fn access boundary (invariant 3)", () => {
	const fns = discoverServerFns();

	test("discovers the server functions", () => {
		expect(fns.length).toBeGreaterThan(10);
	});

	test("every server function is gated or explicitly allowlisted", () => {
		const ungated = fns
			.filter((f) => !f.gated && !PUBLIC_ALLOWLIST.has(f.name))
			.map((f) => `${f.file}:${f.name}`);
		// A non-empty list means someone added a product endpoint without the
		// access-guard middleware — chain `.middleware([accessGuardMiddleware])`
		// or, if truly public, add it to PUBLIC_ALLOWLIST with a justification.
		expect(ungated).toEqual([]);
	});

	test("allowlisted functions exist and are ungated (bare createServerFn)", () => {
		for (const name of PUBLIC_ALLOWLIST) {
			const f = fns.find((x) => x.name === name);
			expect(
				f,
				`allowlisted "${name}" not found — stale allowlist?`,
			).toBeDefined();
			expect(f?.gated).toBe(false);
		}
	});

	// ── §4 role classification (amendment): the auditable list ─────────────
	// Deny-by-default: an unclassified server function fails the build, and a
	// classified one whose middleware CHAIN doesn't match its class fails too —
	// a mutation cannot silently ship member-readable or ungated.

	test("every server function is classified", () => {
		const unclassified = fns
			.filter((f) => !(f.name in SERVER_FN_CLASSIFICATION))
			.map((f) => `${f.file}:${f.name}`);
		// New endpoint? Add a deliberate row to SERVER_FN_CLASSIFICATION.
		expect(unclassified).toEqual([]);
	});

	test("classification has no stale entries", () => {
		const stale = Object.keys(SERVER_FN_CLASSIFICATION).filter(
			(name) => !fns.some((f) => f.name === name),
		);
		expect(stale).toEqual([]);
	});

	test("classification agrees with the public allowlist", () => {
		const classifiedPublic = Object.entries(SERVER_FN_CLASSIFICATION)
			.filter(([, cls]) => cls === "public")
			.map(([name]) => name)
			.sort();
		expect(classifiedPublic).toEqual([...PUBLIC_ALLOWLIST].sort());
	});

	test("every fn's middleware chain matches its declared class", () => {
		const mismatches: string[] = [];
		for (const f of fns) {
			const cls = SERVER_FN_CLASSIFICATION[f.name];
			if (cls === undefined) {
				continue;
			}
			const want = cls.startsWith("permission:")
				? {
						gated: true,
						orgRole: null,
						staff: false,
						permission: cls.slice("permission:".length),
					}
				: cls === "public"
					? { gated: false, orgRole: null, staff: false, permission: null }
					: cls === "authed"
						? { gated: true, orgRole: null, staff: false, permission: null }
						: cls === "member"
							? {
									gated: true,
									orgRole: "member" as const,
									staff: false,
									permission: null,
								}
							: {
									gated: true,
									orgRole: null,
									staff: true,
									permission: null,
								};
			if (
				f.gated !== want.gated ||
				f.orgRole !== want.orgRole ||
				f.staff !== want.staff ||
				f.permission !== want.permission
			) {
				mismatches.push(
					`${f.file}:${f.name} — class "${cls}" wants gated=${want.gated}/org=${want.orgRole}/staff=${want.staff}/permission=${want.permission}, chain has gated=${f.gated}/org=${f.orgRole}/staff=${f.staff}/permission=${f.permission}`,
				);
			}
		}
		expect(mismatches).toEqual([]);
	});
});

describe("org permission gates", () => {
	const fns = discoverServerFns();

	test("every permission middleware names a known permission literal", () => {
		const unknown = fns
			.filter(
				(f) =>
					f.permission !== null &&
					!(ORG_PERMISSIONS as string[]).includes(f.permission),
			)
			.map((f) => `${f.file}:${f.name} (${f.permission})`);
		expect(unknown).toEqual([]);
	});

	test("every org-scoped fn outside the shell names a region scope", () => {
		const unscoped = fns
			.filter(
				(f) =>
					(f.orgRole !== null || f.permission !== null) &&
					f.permission === null &&
					!ORG_SHELL.includes(f.name),
			)
			.map((f) => `${f.file}:${f.name}`);
		expect(unscoped).toEqual([]);
	});

	test("the org shell is exactly the membership-only fns", () => {
		const shell = fns
			.filter((f) => f.orgRole === "member")
			.map((f) => f.name)
			.sort();
		expect(shell).toEqual(ORG_SHELL);
	});

	test("the role-tier admin middleware is never used", () => {
		const legacy = fns
			.filter((f) => f.orgRole === "admin")
			.map((f) => `${f.file}:${f.name}`);
		expect(legacy).toEqual([]);
	});

	test("no permission is computed at runtime", () => {
		const dynamic = fns
			.filter((f) => f.permission === "dynamic")
			.map((f) => `${f.file}:${f.name}`);
		expect(dynamic).toEqual([]);
	});

	test("every mutation needs manage, and every read needs read", () => {
		const wrong = fns
			.filter((f) => f.permission !== null)
			.filter((f) =>
				f.method === "POST"
					? !f.permission?.endsWith(":manage")
					: !f.permission?.endsWith(":read") &&
						!f.permission?.endsWith(":manage"),
			)
			.map((f) => `${f.file}:${f.name} (${f.method} ${f.permission})`);
		expect(wrong).toEqual([]);
	});

	test("no member-level mutation outside the allowlist", () => {
		const leaks = fns
			.filter(
				(f) =>
					f.method === "POST" &&
					f.orgRole === "member" &&
					!MEMBER_MUTATION_ALLOWLIST.has(f.name),
			)
			.map((f) => `${f.file}:${f.name}`);
		expect(leaks).toEqual([]);
	});

	test("no permission-gated mutation is held by plain members", () => {
		const leaks = fns
			.filter(
				(f) =>
					f.method === "POST" &&
					f.permission !== null &&
					f.permission !== "dynamic" &&
					roleHasPermission(
						"member",
						f.permission as (typeof ORG_PERMISSIONS)[number],
					),
			)
			.map((f) => `${f.file}:${f.name}`);
		expect(leaks).toEqual([]);
	});
});

/**
 * §8 grep-proof (CP2 amendment): `active_repo_id` is DEAD. Scope comes from
 * the URL; the one call site that quietly still reads the DB field is the
 * failure mode this scan makes impossible.
 */
describe("active-repo is dead (URL owns scope)", () => {
	const FORBIDDEN =
		/active_repo_id|activeRepoId|getActiveRepo\(|setActiveRepo\(/;

	function scan(dir: string, hits: string[]): void {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (entry.name === "node_modules" || entry.name.startsWith(".")) {
				continue;
			}
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				scan(full, hits);
				continue;
			}
			if (!/\.(ts|tsx)$/.test(entry.name)) {
				continue;
			}
			if (full.endsWith("server-fn-boundary.test.ts")) {
				continue; // this file names the pattern on purpose
			}
			const src = readFileSync(full, "utf8");
			if (FORBIDDEN.test(src)) {
				hits.push(full);
			}
		}
	}

	test("no scoped logic references the retired active-repo field", () => {
		const hits: string[] = [];
		const appsWeb = join(import.meta.dir, "..");
		scan(appsWeb, hits);
		expect(hits).toEqual([]);
	});
});

describe("staff mutations and impersonation guards", () => {
	const fns = discoverServerFns();

	test("every staff mutation refuses cross-site requests", () => {
		const open = fns
			.filter((f) => f.staff && f.method === "POST" && !f.sameOrigin)
			.map((f) => `${f.file}:${f.name}`);
		expect(open).toEqual([]);
	});

	test("the public impersonation and analytics writes are same-origin only", () => {
		for (const name of ["stopImpersonating", "recordDatabuddyAnonId"]) {
			expect(fns.find((f) => f.name === name)?.sameOrigin).toBe(true);
		}
	});

	test("account security changes are refused while impersonating", () => {
		const guarded = fns
			.filter((f) => f.notImpersonating)
			.map((f) => f.name)
			.sort();
		expect(guarded).toEqual(
			[
				"deleteMyAccount",
				"disconnectForge",
				"grantConsentOrgs",
				"grantDeviceOrgs",
				"revokeConnectedAgent",
				"revokeMyOtherSessions",
				"revokeMySession",
			].sort(),
		);
	});
});
