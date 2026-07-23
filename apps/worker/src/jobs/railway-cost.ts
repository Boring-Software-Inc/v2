import {
	RAILWAY_MEASUREMENTS,
	RAILWAY_PROJECT_ID,
	RAILWAY_RATES,
	type RailwayMeasurement,
} from "./railway-rates.ts";

/**
 * Railway cost from the GraphQL usage API (economics-surface-contracts.md). The
 * `usage` query returns billable quantities per measurement per service; we
 * price them with the verified rates (railway-rates.ts) and sum. This is the
 * real month-to-date cost, not a number typed into an env var.
 *
 * Needs an ACCOUNT or WORKSPACE token (railway.com/account/tokens). A
 * project-scoped token returns "Not Authorized" on `usage`.
 */

const ENDPOINT = "https://backboard.railway.com/graphql/v2";

type Fetch = typeof fetch;

export interface RailwayServiceCost {
	serviceId: string;
	name: string;
	/** vCPU-minutes */
	cpuUnits: number;
	/** GB-minutes */
	memGbMin: number;
	/** GB of egress */
	egressGb: number;
	costUsd: number;
}

export interface RailwayCostResult {
	services: RailwayServiceCost[];
	totalUsd: number;
	/** productId to priceDollars, stored for rate-drift detection. */
	prices: Record<string, number>;
	/** True when prices differ from the previous pull (Railway changed pricing). */
	ratesDrift: boolean;
}

interface UsageRow {
	measurement: string;
	value: number;
	serviceId: string | null;
}

const MEASUREMENT_SET = new Set<string>(RAILWAY_MEASUREMENTS);

/**
 * Fold usage rows into per-service quantities and dollars. Pure: the quantities
 * are shown on the page beside the dollars, so a wrong rate reads as "quantities
 * normal, dollars off" instead of a silently drifting number.
 */
export function priceRailwayUsage(
	rows: UsageRow[],
	names: Map<string, string>,
): { services: RailwayServiceCost[]; totalUsd: number } {
	const byService = new Map<string, RailwayServiceCost>();
	const get = (serviceId: string): RailwayServiceCost => {
		let s = byService.get(serviceId);
		if (!s) {
			s = {
				serviceId,
				name: names.get(serviceId) ?? serviceId,
				cpuUnits: 0,
				memGbMin: 0,
				egressGb: 0,
				costUsd: 0,
			};
			byService.set(serviceId, s);
		}
		return s;
	};
	for (const row of rows) {
		if (!MEASUREMENT_SET.has(row.measurement) || !Number.isFinite(row.value)) {
			continue;
		}
		const measurement = row.measurement as RailwayMeasurement;
		const s = get(row.serviceId ?? "(project)");
		s.costUsd += row.value * RAILWAY_RATES[measurement];
		if (measurement === "CPU_USAGE") {
			s.cpuUnits += row.value;
		} else if (measurement === "MEMORY_USAGE_GB") {
			s.memGbMin += row.value;
		} else {
			s.egressGb += row.value;
		}
	}
	const services = [...byService.values()].sort(
		(a, b) => b.costUsd - a.costUsd,
	);
	const totalUsd = services.reduce((sum, s) => sum + s.costUsd, 0);
	return { services, totalUsd };
}

/** True when any product's price changed from the previous pull. */
export function detectRateDrift(
	prev: Record<string, number> | null,
	curr: Record<string, number>,
): boolean {
	if (!prev) {
		return false;
	}
	for (const [productId, price] of Object.entries(curr)) {
		if (prev[productId] !== undefined && prev[productId] !== price) {
			return true;
		}
	}
	return false;
}

async function gql<T>(
	fetchImpl: Fetch,
	token: string,
	query: string,
	variables: Record<string, unknown>,
): Promise<T> {
	const res = await fetchImpl(ENDPOINT, {
		method: "POST",
		headers: {
			authorization: `Bearer ${token}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({ query, variables }),
	});
	if (!res.ok) {
		throw new Error(`railway graphql ${res.status}`);
	}
	const json = (await res.json()) as {
		data?: T;
		errors?: { message: string }[];
	};
	if (json.errors?.length) {
		throw new Error(`railway graphql: ${json.errors[0]?.message}`);
	}
	if (!json.data) {
		throw new Error("railway graphql: no data");
	}
	return json.data;
}

const USAGE_QUERY = `query Usage($projectId: String!, $measurements: [MetricMeasurement!]!, $start: DateTime!, $end: DateTime!) {
  usage(projectId: $projectId, measurements: $measurements, startDate: $start, endDate: $end, groupBy: [SERVICE_ID]) {
    measurement
    value
    tags { serviceId }
  }
}`;

const SERVICES_QUERY = `query Services($id: String!) {
  project(id: $id) { services { edges { node { id name } } } }
}`;

const PRICES_QUERY = `query Prices {
  me { workspaces { customer { subscriptions { items { productId priceDollars } } } } }
}`;

async function fetchUsage(
	fetchImpl: Fetch,
	token: string,
	projectId: string,
	start: string,
	end: string,
): Promise<UsageRow[]> {
	const data = await gql<{
		usage: {
			measurement: string;
			value: number;
			tags?: { serviceId?: string };
		}[];
	}>(fetchImpl, token, USAGE_QUERY, {
		projectId,
		measurements: RAILWAY_MEASUREMENTS,
		start,
		end,
	});
	return (data.usage ?? []).map((u) => ({
		measurement: u.measurement,
		value: typeof u.value === "number" ? u.value : Number(u.value),
		serviceId: u.tags?.serviceId ?? null,
	}));
}

async function fetchServiceNames(
	fetchImpl: Fetch,
	token: string,
	projectId: string,
): Promise<Map<string, string>> {
	const names = new Map<string, string>();
	try {
		const data = await gql<{
			project: {
				services: { edges: { node: { id: string; name: string } }[] };
			};
		}>(fetchImpl, token, SERVICES_QUERY, { id: projectId });
		for (const edge of data.project?.services?.edges ?? []) {
			names.set(edge.node.id, edge.node.name);
		}
	} catch {
		// Names are cosmetic; fall back to service ids if the lookup fails.
	}
	return names;
}

async function fetchPrices(
	fetchImpl: Fetch,
	token: string,
): Promise<Record<string, number>> {
	const prices: Record<string, number> = {};
	try {
		const data = await gql<{
			me: {
				workspaces: {
					customer?: {
						subscriptions?: {
							items?: { productId: string; priceDollars: number }[];
						}[];
					};
				}[];
			};
		}>(fetchImpl, token, PRICES_QUERY, {});
		for (const ws of data.me?.workspaces ?? []) {
			for (const sub of ws.customer?.subscriptions ?? []) {
				for (const item of sub.items ?? []) {
					if (typeof item.priceDollars === "number") {
						prices[item.productId] = item.priceDollars;
					}
				}
			}
		}
	} catch {
		// Drift detection is best-effort; a missing price map just skips the check.
	}
	return prices;
}

/**
 * Pull Railway month-to-date cost for the project, priced per service, plus the
 * subscription prices for rate-drift detection. `prevPrices` is the previous
 * pull's stored price map; drift is true when a product's price moved.
 */
export async function pullRailwayCost(
	fetchImpl: Fetch,
	opts: {
		token: string;
		projectId?: string;
		start: string;
		end: string;
		prevPrices: Record<string, number> | null;
	},
): Promise<RailwayCostResult> {
	const projectId = opts.projectId ?? RAILWAY_PROJECT_ID;
	const [rows, names] = await Promise.all([
		fetchUsage(fetchImpl, opts.token, projectId, opts.start, opts.end),
		fetchServiceNames(fetchImpl, opts.token, projectId),
	]);
	const { services, totalUsd } = priceRailwayUsage(rows, names);
	const prices = await fetchPrices(fetchImpl, opts.token);
	const ratesDrift = detectRateDrift(opts.prevPrices, prices);
	return { services, totalUsd, prices, ratesDrift };
}
