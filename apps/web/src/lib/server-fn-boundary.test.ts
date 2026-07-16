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
]);

const libDir = import.meta.dir;

interface ServerFn {
	name: string;
	/** Whether the builder chain attaches the access-guard middleware. */
	gated: boolean;
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
				gated: chain.includes(".middleware([accessGuardMiddleware])"),
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
	// Deny-by-default at the LIST level in checkpoint 1: an unclassified server
	// function fails the build. The checkpoint-2 URL rewrite adds the org-role
	// middlewares and upgrades this to assert the CHAIN matches the class.

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

	test("member/admin functions all carry the access-gate middleware", () => {
		const ungated = fns
			.filter((f) => SERVER_FN_CLASSIFICATION[f.name] !== "public" && !f.gated)
			.map((f) => `${f.file}:${f.name}`);
		expect(ungated).toEqual([]);
	});
});
