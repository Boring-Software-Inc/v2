import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SERVER_FN_CLASSIFICATION } from "./server-fn-classification.ts";

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
	"getRun", // the unlisted-public run page — readable without a session by design
	"redeemOrgInvite", // §6: redemption APPROVES pending users — gating it deadlocks
]);

const libDir = import.meta.dir;

interface ServerFn {
	name: string;
	/** Whether the builder chain attaches the access-guard middleware. */
	gated: boolean;
	/** Which org-role middleware (if any) the chain attaches. */
	orgRole: "admin" | "member" | null;
	file: string;
}

function discoverServerFns(): ServerFn[] {
	const found: ServerFn[] = [];
	for (const file of readdirSync(libDir)) {
		if (!file.endsWith(".functions.ts")) {
			continue;
		}
		const src = readFileSync(join(libDir, file), "utf8");
		const re = /export const (\w+)\s*=\s*createServerFn\(/g;
		let m: RegExpExecArray | null = re.exec(src);
		while (m !== null) {
			const name = m[1] as string;
			// Gating lives in the builder chain between this declaration and its
			// `.handler(` — a gated fn carries `.middleware([accessGuardMiddleware])`
			// there. (The chain can't wrap `createServerFn` in a helper or the
			// compiler won't split it — gated-server-fn.ts explains why.)
			const handlerIdx = src.indexOf(".handler(", m.index);
			const chain =
				handlerIdx === -1 ? src.slice(m.index) : src.slice(m.index, handlerIdx);
			found.push({
				name,
				gated: chain.includes("accessGuardMiddleware"),
				orgRole: chain.includes("orgAdminMiddleware")
					? "admin"
					: chain.includes("orgMemberMiddleware")
						? "member"
						: null,
				file,
			});
			m = re.exec(src);
		}
	}
	return found;
}

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

	test("every server function is classified (admin/member/public)", () => {
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
			const want =
				cls === "public"
					? { gated: false, orgRole: null }
					: cls === "authed"
						? { gated: true, orgRole: null }
						: cls === "member"
							? { gated: true, orgRole: "member" as const }
							: { gated: true, orgRole: "admin" as const };
			if (f.gated !== want.gated || f.orgRole !== want.orgRole) {
				mismatches.push(
					`${f.file}:${f.name} — class "${cls}" wants gated=${want.gated}/org=${want.orgRole}, chain has gated=${f.gated}/org=${f.orgRole}`,
				);
			}
		}
		expect(mismatches).toEqual([]);
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
