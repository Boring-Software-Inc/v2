import { PLANETSCALE_MONTHLY } from "@tripwire/contracts";
import type { Db } from "@tripwire/db";
import { economicsServices } from "@tripwire/db";
import { getErrorMessage } from "@tripwire/utils";
import type { Logger } from "pino";

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
 * Sum OpenRouter activity spend for one UTC day. The get-user-activity beta
 * endpoint returns an array of per-day records; we sum the dollar field
 * (usage/cost/spend, whichever the record carries) for rows on `day`. Tolerant
 * of the beta shape drifting: unknown records contribute zero, never throw.
 */
export function extractOpenRouterDailyCost(
	json: unknown,
	day: string,
): { costUsd: number; tokens: number } {
	const records: unknown[] = Array.isArray(json)
		? json
		: Array.isArray((json as { data?: unknown[] })?.data)
			? ((json as { data: unknown[] }).data ?? [])
			: [];
	let costUsd = 0;
	let tokens = 0;
	for (const rec of records) {
		if (!rec || typeof rec !== "object") {
			continue;
		}
		const date = (rec as { date?: unknown }).date;
		if (typeof date === "string" && !date.startsWith(day)) {
			continue;
		}
		costUsd += firstFiniteNumber(rec, ["usage", "cost", "spend"]) ?? 0;
		tokens += firstFiniteNumber(rec, ["tokens", "total_tokens"]) ?? 0;
	}
	return { costUsd, tokens };
}

export interface PullConfig {
	openrouter: {
		managementKey: string | null;
		keyHashes: { prod: string | null; eval: string | null };
	};
	railway: { token: string | null; services: string[] };
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
			keyHashes: {
				prod: process.env.OPENROUTER_PROD_KEY_HASH ?? null,
				eval: process.env.OPENROUTER_EVAL_KEY_HASH ?? null,
			},
		},
		railway: {
			token: process.env.RAILWAY_API_TOKEN ?? null,
			services: ["worker", "api", "web"],
		},
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
	const headers = { authorization: `Bearer ${cfg.managementKey}` };
	const query = (keyHash: string | null) => {
		const params = new URLSearchParams({ date: day });
		if (keyHash) {
			params.set("api_key_hash", keyHash);
		}
		return `https://openrouter.ai/api/v1/analytics/get-user-activity?${params}`;
	};
	// One row per keyed source when hashes are configured (prod vs eval COGS
	// cross-check), else a single 'prod-key' total.
	const targets: { service: string; hash: string | null }[] =
		cfg.keyHashes.prod || cfg.keyHashes.eval
			? [
					{ service: "prod-key", hash: cfg.keyHashes.prod },
					{ service: "eval-key", hash: cfg.keyHashes.eval },
				].filter((t) => t.hash)
			: [{ service: "prod-key", hash: null }];
	const rows: ProviderCostRow[] = [];
	for (const target of targets) {
		const res = await fetchImpl(query(target.hash), { headers });
		if (!res.ok) {
			throw new Error(`openrouter analytics ${res.status}`);
		}
		const json = await res.json();
		const { costUsd, tokens } = extractOpenRouterDailyCost(json, day);
		rows.push({
			provider: "openrouter",
			service: target.service,
			costUsd,
			usageJson: { tokens, raw: json },
			estimated: false,
		});
	}
	return rows;
}

async function pullRailway(
	fetchImpl: Fetch,
	cfg: PullConfig["railway"],
	_day: string,
): Promise<ProviderCostRow[]> {
	if (!cfg.token) {
		return [];
	}
	// Railway usage has no documented daily granularity, so we pull the current
	// month-to-date estimated usage and mark it estimated. The rollup reads the
	// latest Railway rows for the floor gauge; deltas are derived downstream.
	const body = JSON.stringify({
		query: `query { estimatedUsage { measurement estimatedValue } }`,
	});
	const res = await fetchImpl("https://backboard.railway.com/graphql/v2", {
		method: "POST",
		headers: {
			authorization: `Bearer ${cfg.token}`,
			"content-type": "application/json",
		},
		body,
	});
	if (!res.ok) {
		throw new Error(`railway graphql ${res.status}`);
	}
	const json = (await res.json()) as {
		data?: {
			estimatedUsage?: { measurement?: string; estimatedValue?: number }[];
		};
	};
	const measurements = json.data?.estimatedUsage ?? [];
	const total = measurements.reduce(
		(sum, m) =>
			sum + (typeof m.estimatedValue === "number" ? m.estimatedValue : 0),
		0,
	);
	// A single account-level MTD figure; service split is not exposed by this
	// query, so it lands under 'main'.
	return [
		{
			provider: "railway",
			service: "main",
			costUsd: total,
			usageJson: json,
			estimated: true,
		},
	];
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
		pullRailway(fetchImpl, config.railway, day),
	);
	// PlanetScale always writes the interpolated accrual, invoice or not.
	await run("planetscale", true, () =>
		pullPlanetScale(fetchImpl, config.planetscale, day),
	);

	deps.logger.info({ day, written, providers }, "provider costs pulled");
	return { day, written, providers };
}
