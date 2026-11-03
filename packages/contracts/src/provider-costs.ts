import { z } from "zod";

const PARSE_ERROR = { error: () => "Invalid provider cost response" };
const finiteNumberSchema = z.number(PARSE_ERROR).nullable().catch(null);
const analyticsRecordSchema = z
	.object(
		{
			api_key_id: z.string(PARSE_ERROR).nullable().catch(null),
			total_usage: finiteNumberSchema,
			usage: finiteNumberSchema,
			cost: finiteNumberSchema,
			tokens_total: z
				.union(
					[z.string(PARSE_ERROR).transform(Number), z.number(PARSE_ERROR)],
					PARSE_ERROR,
				)
				.pipe(z.number(PARSE_ERROR))
				.catch(0),
		},
		PARSE_ERROR,
	)
	.catch({
		api_key_id: null,
		total_usage: null,
		usage: null,
		cost: null,
		tokens_total: 0,
	})
	.transform((record) => ({
		keyName: record.api_key_id,
		costUsd: record.total_usage ?? record.usage ?? record.cost ?? 0,
		tokens: record.tokens_total,
	}));
const analyticsRowsSchema = z.array(analyticsRecordSchema, PARSE_ERROR);
const analyticsDataSchema = z.object({ data: z.unknown() }, PARSE_ERROR);

/** Project analytics rows without changing envelope priority or individual metric fallbacks. */
export const openRouterAnalyticsSchema = z.unknown().transform((value) => {
	const outer = analyticsDataSchema.safeParse(value, PARSE_ERROR);
	if (outer.success) {
		const inner = analyticsDataSchema.safeParse(outer.data.data, PARSE_ERROR);
		if (inner.success) {
			const nested = analyticsRowsSchema.safeParse(
				inner.data.data,
				PARSE_ERROR,
			);
			if (nested.success) {
				return nested.data;
			}
		}
		const rows = analyticsRowsSchema.safeParse(outer.data.data, PARSE_ERROR);
		if (rows.success) {
			return rows.data;
		}
	}
	const rows = analyticsRowsSchema.safeParse(value, PARSE_ERROR);
	return rows.success ? rows.data : [];
});
export type OpenRouterAnalytics = z.infer<typeof openRouterAnalyticsSchema>;

/** Usage values historically use native Number conversion, not finite-only validation. */
export const railwayUsageQuantitySchema = z.unknown().transform(Number);
export type RailwayUsageQuantity = z.infer<typeof railwayUsageQuantitySchema>;

/** Subscription drift compares every numeric primitive, including nonfinite test-double values. */
export const railwaySubscriptionPriceSchema = z.union(
	[
		z.number(PARSE_ERROR),
		z.nan(PARSE_ERROR),
		z.literal(Infinity, PARSE_ERROR),
		z.literal(-Infinity, PARSE_ERROR),
	],
	PARSE_ERROR,
);
export type RailwaySubscriptionPrice = z.infer<
	typeof railwaySubscriptionPriceSchema
>;
