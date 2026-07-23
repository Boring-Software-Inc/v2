import { PLANETSCALE_MONTHLY } from "@tripwire/contracts";
import type { Db } from "@tripwire/db";
import { economicsServices } from "@tripwire/db";
import { getErrorMessage } from "@tripwire/utils";
import type { Logger } from "pino";
import { pullRailwayCost } from "./railway-cost.ts";
import { RAILWAY_RATES_VERIFIED_AT } from "./railway-rates.ts";

/**
 * pull-provider-costs (economics-surface-contracts.md): the daily invoice pull.
 * Railway usage, OpenRouter spend per key, PlanetScale accrual -> provider_costs_daily.
 * Each provider is independently guarded: a missing token or a failing pull skips
 * that provider and never blocks the others. Cron time 01:40 UTC, targeting the
 * UTC day that just closed. This job only reads external APIs and writes the
 * invoice table; it never touches a run.
 */

export interface ProviderCostRow {
	provider: "railway" | "openrouter" | "planetscale";
	service: string;
	costUsd: number;
	usageJson: unknown;
	estimated: boolean;
}

/** Yesterday in UTC as YYYY-MM-DD — the day that closed before a 01:40 run. */
export function previousUtcDay(now: Date): string {
	const d = new Date(now.getTime());
	d.setUTCDate(d.getUTCDate() - 1);
	return d.toISOString().slice(0, 10);
}

function daysInUtcMonth(day: string): number {
	const [y, m] = day.split("-").map(Number);
	if (!y || !m) {
		return 30;
	}
	return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** The UTC day after `day` (YYYY-MM-DD), for a half-open time range. */
function nextUtcDay(day: string): string {
	const d = new Date(`${day}T00:00:00.000Z`);
	d.setUTCDate(d.getUTCDate() + 1);
	return d.toISOString().slice(0, 10);
}

/** First day of the UTC month that `day` falls in, as YYYY-MM-DD. */
function monthStartUtc(day: string): string {
	return `${day.slice(0, 7)}-01`;
}

function firstFiniteNumber(obj: unknown, keys: string[]): number | null {
	if (!obj || typeof obj !== "object") {
		return null;
	}
	for (const key of keys) {
		const v = (obj as Record<string, unknown>)[key];
		if (typeof v === "number" && Number.isFinite(v)) {
			return v;
		}
	}
	return null;
}

/**
 * Sum OpenRouter spend from an analytics/query response. The endpoint returns
 * `{ data: { data: [ { total_usage, tokens_total, ... } ], metadata } }`. The
 * time window is already applied by the request, so we sum every row's
 * `total_usage` (USD) and `tokens_total`. Tolerant of the shape: unknown records
 * contribute zero, never throw. `tokens_total` can arrive as a string.
 */
function analyticsRecords(json: unknown): unknown[] {
	const outer = (json as { data?: unknown })?.data;
	return Array.isArray((outer as { data?: unknown[] })?.data)
		? ((outer as { data: unknown[] }).data ?? [])
		: Array.isArray(outer)
			? (outer as unknown[])
			: Array.isArray(json)
				? (json as unknown[])
				: [];
}

function recordTokens(rec: object): number {
	const tk = (rec as { tokens_total?: unknown; tokens?: unknown }).tokens_total;
	const n = typeof tk === "string" ? Number(tk) : tk;
	return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

export function extractOpenRouterDailyCost(json: unknown): {
	costUsd: number;
	tokens: number;
} {
	let costUsd = 0;
	let tokens = 0;
	for (const rec of analyticsRecords(json)) {
		if (!rec || typeof rec !== "object") {
			continue;
		}
		costUsd += firstFiniteNumber(rec, ["total_usage", "usage", "cost"]) ?? 0;
		tokens += recordTokens(rec);
	}
	return { costUsd, tokens };
}

/**
 * Parse a query grouped by api_key_id into a map of key NAME to spend. The
 * analytics `api_key_id` dimension carries the human key name (e.g. tripwire-prod),
 * which is how prod and eval are separated. The keys API `hash` is NOT accepted
 * as a filter value.
 */
export function extractOpenRouterByKey(
	json: unknown,
): Map<string, { costUsd: number; tokens: number }> {
	const byKey = new Map<string, { costUsd: number; tokens: number }>();
	for (const rec of analyticsRecords(json)) {
		if (!rec || typeof rec !== "object") {
			continue;
		}
		const name = (rec as { api_key_id?: unknown }).api_key_id;
		if (typeof name !== "string") {
			continue;
		}
		byKey.set(name, {
			costUsd: firstFiniteNumber(rec, ["total_usage", "usage", "cost"]) ?? 0,
			tokens: recordTokens(rec),
		});
	}
	return byKey;
}

export interface PullConfig {
	openrouter: {
		managementKey: string | null;
		/** api_key_id (the key NAME) to split prod vs eval spend. */
		keyNames: { prod: string | null; eval: string | null };
	};
	railway: { token: string | null };
	planetscale: {
		tokenId: string | null;
		token: string | null;
		org: string | null;
	};
}

/** Read pull configuration from env. Absent tokens leave a provider disabled. */
export function pullConfigFromEnv(): PullConfig {
	return {
		openrouter: {
			managementKey: process.env.OPENROUTER_MANAGEMENT_KEY ?? null,
			keyNames: {
				prod: process.env.OPENROUTER_PROD_KEY_NAME ?? null,
				eval: process.env.OPENROUTER_EVAL_KEY_NAME ?? null,
			},
		},
		railway: { token: process.env.RAILWAY_API_TOKEN ?? null },
		planetscale: {
			tokenId: process.env.PLANETSCALE_SERVICE_TOKEN_ID ?? null,
			token: process.env.PLANETSCALE_SERVICE_TOKEN ?? null,
			org: process.env.PLANETSCALE_ORG ?? null,
		},
	};
}

type Fetch = typeof fetch;

async function pullOpenRouter(
	fetchImpl: Fetch,
	cfg: PullConfig["openrouter"],
	day: string,
): Promise<ProviderCostRow[]> {
	if (!cfg.managementKey) {
		return [];
	}
	const headers = {
		authorization: `Bearer ${cfg.managementKey}`,
		"content-type": "application/json",
	};
	const nextDay = nextUtcDay(day);
	const split = Boolean(cfg.keyNames.prod || cfg.keyNames.eval);
	// One POST to /api/v1/analytics/query for the day. When splitting, group by
	// api_key_id (the key NAME) so prod and eval land in their own rows; otherwise
	// take the account aggregate as 'prod-key' (which includes eval until the key
	// names are set).
	const body = JSON.stringify({
		metrics: ["total_usage", "tokens_total"],
		...(split ? { dimensions: ["api_key_id"] } : {}),
		time_range: { start: `${day}T00:00:00Z`, end: `${nextDay}T00:00:00Z` },
	});
	const res = await fetchImpl("https://openrouter.ai/api/v1/analytics/query", {
		method: "POST",
		headers,
		body,
	});
	if (!res.ok) {
		throw new Error(`openrouter analytics ${res.status}`);
	}
	const json = await res.json();

	if (!split) {
		const { costUsd, tokens } = extractOpenRouterDailyCost(json);
		return [
			{
				provider: "openrouter",
				service: "prod-key",
				costUsd,
				usageJson: { tokens, raw: json },
				estimated: false,
			},
		];
	}
	// Match prod/eval by key name; a key with no spend that day yields a 0 row so
	// the page reads $0 rather than going blank.
	const byKey = extractOpenRouterByKey(json);
	const rows: ProviderCostRow[] = [];
	for (const [service, name] of [
		["prod-key", cfg.keyNames.prod],
		["eval-key", cfg.keyNames.eval],
	] as const) {
		if (!name) {
			continue;
		}
		const agg = byKey.get(name) ?? { costUsd: 0, tokens: 0 };
		rows.push({
			provider: "openrouter",
			service,
			costUsd: agg.costUsd,
			usageJson: { tokens: agg.tokens, keyName: name },
			estimated: false,
		});
	}
	return rows;
}

/**
 * Pull Railway month-to-date cost from the GraphQL usage API, priced per service
 * with the verified rates. Writes one row per service (with the raw quantities)
 * plus a `rates` row carrying the subscription prices and the drift flag. The
 * usage window is the month through the target day. Needs an account/workspace
 * token; a project token returns Not Authorized.
 */
async function pullRailway(
	db: Db,
	fetchImpl: Fetch,
	token: string,
	day: string,
): Promise<ProviderCostRow[]> {
	const prevPrices = await economicsServices.getLastRailwayPrices(db);
	const result = await pullRailwayCost(fetchImpl, {
		token,
		start: `${monthStartUtc(day)}T00:00:00Z`,
		end: `${nextUtcDay(day)}T00:00:00Z`,
		prevPrices,
	});
	const rows: ProviderCostRow[] = result.services.map((s) => ({
		provider: "railway",
		service: s.serviceId,
		costUsd: s.costUsd,
		usageJson: {
			name: s.name,
			cpuUnits: s.cpuUnits,
			memGbMin: s.memGbMin,
			egressGb: s.egressGb,
		},
		estimated: true,
	}));
	// The rates row is metadata, not a cost line (costUsd 0, excluded from sums).
	rows.push({
		provider: "railway",
		service: "rates",
		costUsd: 0,
		usageJson: {
			prices: result.prices,
			ratesDrift: result.ratesDrift,
			verifiedAt: RAILWAY_RATES_VERIFIED_AT,
		},
		estimated: false,
	});
	return rows;
}

async function pullPlanetScale(
	fetchImpl: Fetch,
	cfg: PullConfig["planetscale"],
	day: string,
): Promise<ProviderCostRow[]> {
	// PlanetScale is modeled flat-accrued, so the daily figure is interpolated
	// and marked estimated. When a service token is present we also pull the
	// invoice for audit and credit tracking; the interpolated cost stands either
	// way so the page never blocks on the invoice API.
	const daily = PLANETSCALE_MONTHLY / daysInUtcMonth(day);
	let usageJson: unknown = { note: "interpolated from PLANETSCALE_MONTHLY" };
	if (cfg.tokenId && cfg.token && cfg.org) {
		const res = await fetchImpl(
			`https://api.planetscale.com/v1/organizations/${cfg.org}/invoices`,
			{
				headers: {
					authorization: `${cfg.tokenId}:${cfg.token}`,
					accept: "application/json",
				},
			},
		);
		if (res.ok) {
			usageJson = await res.json();
		}
	}
	return [
		{
			provider: "planetscale",
			service: "main",
			costUsd: daily,
			usageJson,
			estimated: true,
		},
	];
}

export interface PullDeps {
	db: Db;
	logger: Logger;
	fetchImpl?: Fetch;
	config?: PullConfig;
	now?: Date;
}

export interface PullResult {
	day: string;
	written: number;
	providers: Record<string, "ok" | "skipped" | "failed">;
}

export async function pullProviderCosts(deps: PullDeps): Promise<PullResult> {
	const fetchImpl = deps.fetchImpl ?? fetch;
	const config = deps.config ?? pullConfigFromEnv();
	const day = previousUtcDay(deps.now ?? new Date());
	const providers: PullResult["providers"] = {};
	let written = 0;

	const run = async (
		name: string,
		enabled: boolean,
		fn: () => Promise<ProviderCostRow[]>,
	) => {
		if (!enabled) {
			providers[name] = "skipped";
			return;
		}
		try {
			const rows = await fn();
			for (const row of rows) {
				await economicsServices.upsertProviderCost(deps.db, { day, ...row });
				written++;
			}
			providers[name] = "ok";
		} catch (error) {
			providers[name] = "failed";
			deps.logger.warn(
				{ provider: name, error: getErrorMessage(error) },
				"provider cost pull failed — other providers unaffected",
			);
		}
	};

	await run("openrouter", Boolean(config.openrouter.managementKey), () =>
		pullOpenRouter(fetchImpl, config.openrouter, day),
	);
	await run("railway", Boolean(config.railway.token), () =>
		pullRailway(deps.db, fetchImpl, config.railway.token as string, day),
	);
	// PlanetScale always writes the interpolated accrual, invoice or not.
	await run("planetscale", true, () =>
		pullPlanetScale(fetchImpl, config.planetscale, day),
	);

	deps.logger.info({ day, written, providers }, "provider costs pulled");
	return { day, written, providers };
}
