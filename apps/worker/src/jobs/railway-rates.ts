/**
 * Railway per-unit rates. THIS IS THE ONLY PLACE THE RATES LIVE.
 *
 * Railway bills three measurements. The `usage` GraphQL query returns the raw
 * quantity for each; multiply by these rates and sum to get the dollar cost.
 *
 * Verified 2026-07-22 against the three real services in project
 * 7ead5fdf-74e5-4b58-96aa-8f99968f0c44 for the July 2026 billing period. Computed
 * vs the Railway dashboard: web $0.264 vs $0.26, worker $0.620 vs $0.60, api
 * $0.495 vs $0.49. Three independent per-service confirmations.
 *
 * If the rate-drift check flags a change, Railway moved its pricing. Re-verify
 * against the dashboard and update the numbers HERE, nowhere else.
 */
export const RAILWAY_RATES = {
	/** per vCPU-minute */
	CPU_USAGE: 0.000463,
	/** per GB-minute */
	MEMORY_USAGE_GB: 0.000231,
	/** per GB of egress */
	NETWORK_TX_GB: 0.05,
} as const;

export type RailwayMeasurement = keyof typeof RAILWAY_RATES;

export const RAILWAY_MEASUREMENTS = Object.keys(
	RAILWAY_RATES,
) as RailwayMeasurement[];

/** When the rates above were last confirmed against the dashboard. */
export const RAILWAY_RATES_VERIFIED_AT = "2026-07-22";

/** The tripwire Railway project the usage query is scoped to. Not a secret. */
export const RAILWAY_PROJECT_ID = "7ead5fdf-74e5-4b58-96aa-8f99968f0c44";
