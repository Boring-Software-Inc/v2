import { createDb } from "@tripwire/db";

/**
 * Tripwire unit economics. Read-only. SELECT-only queries for live denominators,
 * external billing as named constants. No writes, no DDL, no schema changes.
 *
 * Run live:   bun --env-file=.env.production run scripts/economics.ts
 * Run offline: bun run scripts/economics.ts   (uses the dated snapshot below)
 *
 * Every number printed traces to an EXTERNAL input, a live query result, or a
 * named ASSUMPTION. Nothing here is an unlabeled estimate.
 */

// ---------------------------------------------------------------------------
// EXTERNAL INPUTS (ground truth, provided by the operator, not re-derived)
// ---------------------------------------------------------------------------
const EXTERNAL = {
	windowDays: 30,
	asOf: "2026-07-22",

	// Railway, month to date. Rates per unit.
	railway: {
		worker: { cpu: 0.1308, ram: 0.3396, egress: 0.1343 }, // USD
		api: { cpu: 0.0567, ram: 0.3972, egress: 0.0335 },
		web: { cpu: 0.0018, ram: 0.2354, egress: 0.0203 },
		floorMonthly: 5, // Hobby plan, $5 included usage
		usageMtd: 1.4, // current MTD usage, under the $5 floor
	},

	// OpenRouter, trailing 30 days. NOTE: this spend is CONTAMINATED by the eval
	// harness (scripts/eval/run.ts) and dev/test traffic on the same API key. It
	// is NOT production-run cost. Kept for provenance only. Marginal AI cost is
	// measured bottom-up from persisted production traces (see MEASURED below).
	openrouter: {
		spend: 4.73,
		requests: 477,
		totalTokens: 2_460_000,
		blendedPerM: 1.92,
		cacheHitRateDashboard: 0.264,
	},

	// Grok 4.5 list pricing (the prod AI_REVIEW_MODEL, confirmed by operator).
	grok: {
		inputPerM: 0.557,
		outputPerM: 6.49,
		// Cache-read discount is not in the provided inputs. Named assumption A3b:
		// cache-read billed at 25% of input list, the common provider convention.
		cacheReadFraction: 0.25,
	},

	// PlanetScale Scaler Pro, PS-5, 3 nodes.
	planetscale: {
		monthlyAccrued: 45,
		credits: 1000,
		storageUsedMb: 553,
		storageCapMb: 10 * 1024,
		egressUsedGb: 1.02,
		egressIncludedGb: 100,
	},
};

// ---------------------------------------------------------------------------
// MEASURED SNAPSHOT (from read-only SELECT queries, run 2026-07-22 vs prod).
// Used as fallback when no DATABASE_URL is present. When live, the queries below
// refresh these. See ECONOMICS.md for the exact SQL and the trace-shape caveat.
// ---------------------------------------------------------------------------
const SNAPSHOT = {
	runs30d: 276, // 273 completed, 2 paused, 1 failed
	steps30d: 1895,
	events30d: 1231,
	activeOrgs30d: 2,
	activeRepos30d: 3,
	// Runs whose ai-review step carries a REAL OpenRouter usage trace (not seed).
	realAiReviewedRuns30d: 7,
	realAiRequests30d: 7,
	aiInputTokens30d: 14_327,
	aiOutputTokens30d: 2_388,
	aiCacheReadTokens30d: 128,
	// All-time, for context and storage growth per run.
	runsAll: 877,
	stepsAll: 6331,
	eventsAll: 1832,
	// Per-table storage bytes (Q9), for the tier-break math.
	storageBytes: {
		events: 7_462_912,
		run_steps: 3_792_896,
		runs: 1_818_624,
		run_actions: 1_032_192,
	},
};

// Static system-prompt prefix, the only cacheable content. instructions-v2.md is
// 4165 chars; ~4 chars/token (assumption A3a) => ~1041 tokens.
const INSTRUCTIONS_PREFIX_TOKENS = Math.round(4165 / 4);

// ---------------------------------------------------------------------------
// Live refresh (read-only). Falls back to SNAPSHOT if the DB is unreachable.
// ---------------------------------------------------------------------------
async function refresh(): Promise<typeof SNAPSHOT> {
	if (!process.env.DATABASE_URL) {
		console.log("[no DATABASE_URL] using dated snapshot 2026-07-22\n");
		return SNAPSHOT;
	}
	const { pool } = createDb();
	const one = async (sql: string) => (await pool.query(sql)).rows[0];
	try {
		const w = "created_at >= now() - interval '30 days'";
		const r = await one(`SELECT count(*)::int n FROM runs WHERE ${w}`);
		const s = await one(
			`SELECT count(*)::int n FROM run_steps s JOIN runs r ON s.run_id=r.id WHERE r.${w}`,
		);
		const e = await one(
			`SELECT count(*)::int n FROM events WHERE received_at >= now() - interval '30 days'`,
		);
		const org = await one(
			`SELECT count(DISTINCT rp.org_id)::int n FROM runs r JOIN repos rp ON rp.full_name=r.repo_full_name WHERE r.${w} AND rp.org_id IS NOT NULL`,
		);
		const rep = await one(
			`SELECT count(DISTINCT repo_full_name)::int n FROM runs r WHERE ${w}`,
		);
		const tok = await one(
			`WITH t AS (
			   SELECT s.run_id, s.evidence->'evidence'->'trace' AS tr
			   FROM run_steps s JOIN runs r ON s.run_id=r.id
			   WHERE r.${w} AND s.rule_id LIKE 'ai-review@%'
			     AND ((s.evidence->'evidence'->'trace') ? 'usage'))
			 SELECT count(*)::int requests, count(DISTINCT run_id)::int runs,
			   sum(COALESCE((tr->'usage'->>'input')::bigint,(tr->'usage'->>'inputTokens')::bigint)) input,
			   sum(COALESCE((tr->'usage'->>'output')::bigint,(tr->'usage'->>'outputTokens')::bigint)) output,
			   sum(COALESCE((tr->'usage'->>'cached')::bigint,(tr->'usage'->'inputTokenDetails'->>'cacheReadTokens')::bigint)) cached
			 FROM t`,
		);
		console.log("[live] refreshed denominators from prod\n");
		return {
			...SNAPSHOT,
			runs30d: r.n,
			steps30d: s.n,
			events30d: e.n,
			activeOrgs30d: org.n,
			activeRepos30d: rep.n,
			realAiReviewedRuns30d: tok.runs ?? 0,
			realAiRequests30d: tok.requests ?? 0,
			aiInputTokens30d: Number(tok.input ?? 0),
			aiOutputTokens30d: Number(tok.output ?? 0),
			aiCacheReadTokens30d: Number(tok.cached ?? 0),
		};
	} finally {
		await pool.end();
	}
}

const usd = (n: number, dp = 4) => `$${n.toFixed(dp)}`;
const line = () => console.log("-".repeat(72));

async function main() {
	const m = await refresh();

	// -----------------------------------------------------------------------
	// FIXED costs
	// -----------------------------------------------------------------------
	const fixedAccrued =
		EXTERNAL.railway.floorMonthly + EXTERNAL.planetscale.monthlyAccrued; // $50
	const fixedCash = EXTERNAL.railway.floorMonthly; // PS on credits => $0 cash

	// Railway split: RAM + web = fixed baseline; worker+api CPU+egress = marginal.
	const rw = EXTERNAL.railway;
	const railwayMarginalMtd =
		rw.worker.cpu + rw.worker.egress + rw.api.cpu + rw.api.egress; // scales with runs
	const railwayBaselineMtd =
		rw.worker.ram + rw.api.ram + rw.web.cpu + rw.web.ram + rw.web.egress; // fixed
	const railwayPerRun = railwayMarginalMtd / m.runs30d; // assumption A1/A2

	// -----------------------------------------------------------------------
	// MARGINAL AI cost per reviewed run (measured, bottom-up, Grok pricing)
	// -----------------------------------------------------------------------
	const inPerReq = m.aiInputTokens30d / m.realAiRequests30d;
	const outPerReq = m.aiOutputTokens30d / m.realAiRequests30d;
	const cacheReadFrac = m.aiCacheReadTokens30d / m.aiInputTokens30d; // observed
	// Cost at observed cache: cache-read tokens billed at the discount, rest full.
	const g = EXTERNAL.grok;
	const inputCostPerReq =
		((inPerReq - m.aiCacheReadTokens30d / m.realAiRequests30d) * g.inputPerM +
			(m.aiCacheReadTokens30d / m.realAiRequests30d) *
				g.inputPerM *
				g.cacheReadFraction) /
		1e6;
	const outputCostPerReq = (outPerReq * g.outputPerM) / 1e6;
	const aiPerReviewMeasured = inputCostPerReq + outputCostPerReq;
	// Top-down cross-check using OpenRouter blended rate on the SAME persisted tokens.
	const aiPerReviewBlended =
		((m.aiInputTokens30d + m.aiOutputTokens30d) *
			EXTERNAL.openrouter.blendedPerM) /
		1e6 /
		m.realAiRequests30d;

	const marginalPerReviewedRun = aiPerReviewMeasured + railwayPerRun;

	// -----------------------------------------------------------------------
	// UNIT COSTS (accrued + cash), fixed-dominated at current volume
	// -----------------------------------------------------------------------
	console.log(
		"TRIPWIRE UNIT ECONOMICS  (as of",
		EXTERNAL.asOf,
		", 30-day window)",
	);
	line();
	console.log("Denominators (live/snapshot):");
	console.log(`  runs                 ${m.runs30d}`);
	console.log(`  run steps            ${m.steps30d}`);
	console.log(
		`  real AI-reviewed runs ${m.realAiReviewedRuns30d}  (persisted OpenRouter traces)`,
	);
	console.log(`  active orgs          ${m.activeOrgs30d}`);
	console.log(`  active repos         ${m.activeRepos30d}`);
	console.log(`  events               ${m.events30d}`);
	line();
	console.log(
		"Fixed cost (accrued):",
		usd(fixedAccrued, 2),
		"/mo   (Railway floor $5 + PlanetScale $45)",
	);
	console.log(
		"Fixed cost (cash):   ",
		usd(fixedCash, 2),
		"/mo   (PlanetScale on $1000 credits => $0 cash)",
	);
	console.log(
		"Railway marginal MTD:",
		usd(railwayMarginalMtd),
		" baseline MTD:",
		usd(railwayBaselineMtd),
	);
	line();
	console.log("MARGINAL cost:");
	console.log(
		`  AI per reviewed run (measured, Grok)  ${usd(aiPerReviewMeasured)}`,
	);
	console.log(
		`  AI per reviewed run (blended x-check) ${usd(aiPerReviewBlended)}`,
	);
	console.log(
		`    input tokens/req  ${inPerReq.toFixed(0)}   output tokens/req ${outPerReq.toFixed(0)}`,
	);
	console.log(
		`    observed cache-read fraction ${(cacheReadFrac * 100).toFixed(1)}%`,
	);
	console.log(
		`  Railway per run (worker+api CPU+egress) ${usd(railwayPerRun)}`,
	);
	console.log(
		`  Marginal per reviewed run (AI+Railway)  ${usd(marginalPerReviewedRun)}`,
	);
	line();
	console.log("FULLY LOADED unit cost (fixed spread over current volume):");
	console.log(
		`  per run   accrued ${usd(fixedAccrued / m.runs30d)}   cash ${usd(fixedCash / m.runs30d)}`,
	);
	console.log(`  per step  accrued ${usd(fixedAccrued / m.steps30d)}`);
	console.log(
		`  per org   accrued ${usd(fixedAccrued / m.activeOrgs30d, 2)}   cash ${usd(fixedCash / m.activeOrgs30d, 2)}`,
	);
	console.log(`  per repo  accrued ${usd(fixedAccrued / m.activeRepos30d, 2)}`);
	line();

	// -----------------------------------------------------------------------
	// PROJECTIONS: 1x / 5x / 25x / 100x runs, 30d and 6mo
	// -----------------------------------------------------------------------
	const aiShare = m.realAiReviewedRuns30d / m.runs30d; // assumption A7: held ratio
	console.log(
		"PROJECTIONS  (AI-reviewed share held at",
		`${(aiShare * 100).toFixed(1)}%, assumption A7)`,
	);
	console.log(
		"scenario | runs/mo | Railway usage | Railway billed | AI/mo | accrued/mo | 6mo accrued",
	);
	for (const x of [1, 5, 25, 100]) {
		const runs = m.runs30d * x;
		const railwayUsage = railwayBaselineMtd + railwayMarginalMtd * x;
		const railwayBilled = Math.max(rw.floorMonthly, railwayUsage);
		const aiMonthly = runs * aiShare * aiPerReviewMeasured;
		const accrued =
			railwayBilled + EXTERNAL.planetscale.monthlyAccrued + aiMonthly;
		console.log(
			`${x}x`.padEnd(9) +
				`| ${runs}`.padEnd(10) +
				`| ${usd(railwayUsage, 2)}`.padEnd(16) +
				`| ${usd(railwayBilled, 2)}`.padEnd(17) +
				`| ${usd(aiMonthly, 2)}`.padEnd(8) +
				`| ${usd(accrued, 2)}`.padEnd(13) +
				`| ${usd(accrued * 6, 2)}`,
		);
	}
	// Railway floor crossing.
	const crossX = (rw.floorMonthly - railwayBaselineMtd) / railwayMarginalMtd;
	console.log(
		`\nRailway crosses the $5 included floor at ${crossX.toFixed(1)}x = ~${Math.round(m.runs30d * crossX)} runs/mo.`,
	);

	// -----------------------------------------------------------------------
	// FIXED-COST TIER BREAKS
	// -----------------------------------------------------------------------
	const bytesPerRun =
		(m.storageBytes.run_steps +
			m.storageBytes.runs +
			m.storageBytes.run_actions) /
			m.runsAll +
		(m.storageBytes.events / m.eventsAll) * (m.eventsAll / m.runsAll); // events per run
	const headroomBytes =
		(EXTERNAL.planetscale.storageCapMb - EXTERNAL.planetscale.storageUsedMb) *
		1024 *
		1024;
	const runsToFillStorage = headroomBytes / bytesPerRun;
	console.log(
		`\nPlanetScale storage: ~${bytesPerRun.toFixed(0)} bytes/run growth (runs+steps+actions+events).`,
	);
	console.log(
		`  10 GB cap reached after ~${Math.round(runsToFillStorage).toLocaleString()} more runs.`,
	);
	console.log(
		`  At 100x (${m.runs30d * 100}/mo) that is ~${(runsToFillStorage / (m.runs30d * 100)).toFixed(1)} months.`,
	);
	console.log(
		"  Egress 1.02 GB of 100 GB included: not a constraint at any modeled scale.",
	);
	const creditMonths =
		EXTERNAL.planetscale.credits / EXTERNAL.planetscale.monthlyAccrued;
	console.log(
		`\nCredit exhaustion: $1000 / $45 = ${creditMonths.toFixed(1)} months at the current PS tier.`,
	);
	console.log(
		"  No modeled scenario forces a PS tier change within 6 months, so the burn rate holds.",
	);
	line();

	// -----------------------------------------------------------------------
	// CACHE SENSITIVITY  (A3 reworked: cap best case at the cacheable fraction)
	// -----------------------------------------------------------------------
	const cacheableFraction = INSTRUCTIONS_PREFIX_TOKENS / inPerReq;
	console.log("CACHE SENSITIVITY  (only the instructions prefix is cacheable)");
	console.log(
		`  instructions prefix ~${INSTRUCTIONS_PREFIX_TOKENS} tokens / ${inPerReq.toFixed(0)} avg input = ${(cacheableFraction * 100).toFixed(0)}% cacheable (this small-PR sample).`,
	);
	console.log(
		"  A 60k-char diff (~15k tokens) drops the cacheable fraction to ~7%.",
	);
	console.log(
		`  The provider-typical 89% cache rate is UNREACHABLE: it exceeds the ${(Math.min(1, cacheableFraction) * 100).toFixed(0)}% cap.`,
	);
	// Cost per review at cache hit h (fraction of the CACHEABLE prefix served cached).
	const costAtCache = (h: number) => {
		const cap = Math.min(1, cacheableFraction);
		const hEff = Math.min(h, cap); // cannot cache more than the cacheable prefix
		const cachedTok = INSTRUCTIONS_PREFIX_TOKENS * (hEff / Math.max(cap, 1e-9));
		const fullInput = inPerReq - cachedTok;
		const inputCost =
			(fullInput * g.inputPerM +
				cachedTok * g.inputPerM * g.cacheReadFraction) /
			1e6;
		return inputCost + outputCostPerReq;
	};
	for (const h of [0, 0.264, 0.6, cacheableFraction]) {
		const label =
			h === cacheableFraction
				? `${(h * 100).toFixed(0)}% (best case, full prefix)`
				: `${(h * 100).toFixed(1)}%`;
		console.log(`  cache ${label.padEnd(28)} => ${usd(costAtCache(h))}/review`);
	}
	const save = costAtCache(0) - costAtCache(cacheableFraction);
	console.log(
		`  Best-case saving vs zero cache: ${usd(save)}/review (${((save / costAtCache(0)) * 100).toFixed(0)}%).`,
	);
	console.log(
		"  Lever: OUTPUT reasoning tokens dominate cost and are not cacheable.",
	);
	console.log(
		"  The prompt is already cache-first (system before diff). Traffic density, not",
	);
	console.log(
		"  restructuring, is why the observed rate is low: sparse traffic leaves caches cold.",
	);
	line();

	// -----------------------------------------------------------------------
	// PRICING SCAFFOLDING  (change #1: measured marginal, not $0.01)
	// -----------------------------------------------------------------------
	const marginalRun = marginalPerReviewedRun; // measured
	const upperRun = 0.01; // sensitivity ceiling for large-diff orgs
	console.log(
		"PRICING SCAFFOLDING  (Dependabot/Snyk motion: free for OSS, paid for commercial)",
	);
	console.log(
		`  Measured marginal per reviewed run: ${usd(marginalRun)}  (sensitivity ceiling ${usd(upperRun, 2)})`,
	);
	console.log("\n  Free-org monthly SUBSIDY by allowance:");
	for (const alloc of [25, 50, 100]) {
		console.log(
			`    ${alloc} runs/mo: ${usd(alloc * marginalRun, 3)} measured   ${usd(alloc * upperRun, 2)} ceiling`,
		);
	}
	console.log(
		"\n  Free orgs one paid org carries (subsidy only, fixed cost excluded):",
	);
	console.log("  allowance | $19 | $29 | $49   (measured marginal)");
	for (const alloc of [25, 50, 100]) {
		const sub = alloc * marginalRun;
		console.log(
			`    ${alloc}`.padEnd(12) +
				`| ${Math.floor(19 / sub)}`.padEnd(6) +
				`| ${Math.floor(29 / sub)}`.padEnd(6) +
				`| ${Math.floor(49 / sub)}`,
		);
	}
	const payToFloor19 = Math.ceil(fixedAccrued / 19);
	console.log(
		`\n  Binding constraint at current scale is FIXED cost, not subsidy: it takes`,
	);
	console.log(
		`  ${payToFloor19} paid orgs at $19 (or 2 at $29/$49) just to cover the ${usd(fixedAccrued, 0)}/mo floor.`,
	);
	console.log(
		`  Free-org subsidy (${usd(50 * marginalRun, 2)} at a 50-run allowance) is trivial next to that floor.`,
	);
	line();
	console.log(
		"See ECONOMICS.md for assumptions (A1-A7), SQL, and the honesty ledger.",
	);
}

main();
