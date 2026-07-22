/**
 * Enforces the spec §3 dependency arrows. Reads every `@tripwire/*` import in
 * `packages/*` and `apps/*` source and fails the build on any wrong-direction
 * edge. At agent speed, structure is documentation — this is the enforcer.
 *
 * Run: `bun run scripts/check-boundaries.ts` (also in CI).
 */
import { Glob } from "bun";

/**
 * For each workspace, the set of `@tripwire/*` packages it is ALLOWED to import.
 * Derived verbatim from the arrows:
 *   contracts    ← everything            (imports nothing but zod)
 *   utils        ← everything except contracts
 *   forge        ← forge-github, worker
 *   core         ← worker ONLY
 *   sdk          ← forge-github, worker  (signal registry + defineForge; pure)
 *   db           ← worker, api, web
 *   forge-github ← worker, api
 *   ui           ← web
 * apps import packages; packages never import apps; nothing imports core but worker.
 */
const ALLOWED: Record<string, readonly string[]> = {
	// packages
	auth: ["contracts", "utils", "db"],
	contracts: [],
	utils: ["contracts"],
	forge: ["contracts"],
	core: ["contracts", "utils", "sdk"],
	sdk: ["contracts"],
	"forge-github": ["contracts", "utils", "forge", "sdk"],
	db: ["contracts", "utils"],
	ui: [],
	// apps
	web: ["auth", "contracts", "utils", "db", "ui"],
	api: ["auth", "contracts", "utils", "db", "forge-github"],
	worker: ["contracts", "utils", "core", "db", "forge", "forge-github", "sdk"],
};

const KNOWN = new Set(Object.keys(ALLOWED));

/** Matches `from "@tripwire/<name>"` and bare `import "@tripwire/<name>"`. */
const IMPORT_RE =
	/(?:from|import)\s+["']@tripwire\/([a-z-]+)(?:\/[^"']*)?["']/g;

type Violation = {
	file: string;
	importer: string;
	target: string;
	reason: string;
};

const violations: Violation[] = [];

for (const root of ["packages", "apps"]) {
	const glob = new Glob(`${root}/*/src/**/*.{ts,tsx}`);
	for await (const file of glob.scan({ cwd: process.cwd(), absolute: false })) {
		if (file.includes("routeTree.gen.ts")) {
			continue;
		}
		const importer = file.split("/")[1];
		if (!(importer && KNOWN.has(importer))) {
			// A workspace with no arrows defined (e.g. mcp) shouldn't import
			// tripwire packages at all yet.
			continue;
		}
		const source = await Bun.file(file).text();
		const allowed = ALLOWED[importer] ?? [];
		for (const match of source.matchAll(IMPORT_RE)) {
			const target = match[1];
			if (!target || target === importer) {
				continue;
			}
			if (!KNOWN.has(target)) {
				violations.push({
					file,
					importer,
					target,
					reason: `unknown or non-importable package @tripwire/${target}`,
				});
				continue;
			}
			if (!allowed.includes(target)) {
				violations.push({
					file,
					importer,
					target,
					reason: `@tripwire/${importer} may not import @tripwire/${target} (see spec §3 arrows)`,
				});
			}
		}
	}
}

if (violations.length > 0) {
	console.error(
		`✗ boundary check failed — ${violations.length} illegal import(s):\n`,
	);
	for (const v of violations) {
		console.error(`  ${v.file}`);
		console.error(
			`    @tripwire/${v.importer} → @tripwire/${v.target}: ${v.reason}\n`,
		);
	}
	process.exit(1);
}

console.log(
	"✓ boundary check passed — all @tripwire/* imports respect the §3 arrows",
);
