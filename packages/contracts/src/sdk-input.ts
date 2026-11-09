import { z } from "zod";

/** SDK numbers are not limited to finite JSON; static errors avoid reading rejected object metadata. */
export const sdkNumberArgumentSchema = z.union([
	z.number({ error: "Expected a JavaScript number" }),
	z.nan({ error: "Expected NaN" }),
	z.literal(Number.POSITIVE_INFINITY),
	z.literal(Number.NEGATIVE_INFINITY),
]);
export type SdkNumberArgument = z.infer<typeof sdkNumberArgumentSchema>;

export const sdkNumberValueSchema = sdkNumberArgumentSchema.refine(
	(value) => !Number.isNaN(value),
);
export type SdkNumberValue = z.infer<typeof sdkNumberValueSchema>;

export const sdkTextValueSchema = z.string();
export type SdkTextValue = z.infer<typeof sdkTextValueSchema>;
export const sdkBooleanValueSchema = z.boolean();
export type SdkBooleanValue = z.infer<typeof sdkBooleanValueSchema>;
export const sdkRegexArgumentSchema = z.instanceof(RegExp);
export type SdkRegexArgument = z.infer<typeof sdkRegexArgumentSchema>;

/** Custom list gates preserve sparse entries and the original array reference. */
export const sdkListArgumentSchema = z.custom<readonly unknown[]>(
	Array.isArray,
);
export type SdkListArgument = z.infer<typeof sdkListArgumentSchema>;
export const sdkStringListSchema = z.custom<string[]>(
	(value) =>
		Array.isArray(value) &&
		!value.some((entry) => !sdkTextValueSchema.safeParse(entry).success),
);
export type SdkStringList = z.infer<typeof sdkStringListSchema>;

const sdkObjectSchema = z.custom<object>(
	(value) =>
		value !== null &&
		Object(value) === value &&
		!z.function().safeParse(value).success,
);

export const sdkTextMapSchema = z.custom<Readonly<Record<string, string>>>(
	(value) => {
		const parsed = sdkObjectSchema.safeParse(value);
		return (
			parsed.success &&
			!Array.isArray(value) &&
			!Object.values(parsed.data).some(
				(text) => !sdkTextValueSchema.safeParse(text).success,
			)
		);
	},
);
export type SdkTextMap = z.infer<typeof sdkTextMapSchema>;

/** Live SDK data may carry inherited fields or array properties. */
export const sdkScanMatchSchema = z.custom<{
	readonly kind: string;
	readonly value: string;
	readonly location: string;
}>((value) => {
	const parsed = sdkObjectSchema.safeParse(value);
	return (
		parsed.success &&
		sdkTextValueSchema.safeParse(Reflect.get(parsed.data, "kind")).success &&
		sdkTextValueSchema.safeParse(Reflect.get(parsed.data, "value")).success &&
		sdkTextValueSchema.safeParse(Reflect.get(parsed.data, "location")).success
	);
});
export type SdkScanMatch = z.infer<typeof sdkScanMatchSchema>;
export const sdkScanMatchesSchema = z.custom<readonly SdkScanMatch[]>(
	(value) =>
		Array.isArray(value) &&
		value.every((entry) => sdkScanMatchSchema.safeParse(entry).success),
);
export type SdkScanMatches = z.infer<typeof sdkScanMatchesSchema>;

export const sdkScanPatternSchema = z.custom<{
	readonly kind: string;
	readonly pattern: RegExp;
}>((value) => {
	const parsed = sdkObjectSchema.safeParse(value);
	return (
		parsed.success &&
		sdkTextValueSchema.safeParse(Reflect.get(parsed.data, "kind")).success &&
		sdkRegexArgumentSchema.safeParse(Reflect.get(parsed.data, "pattern"))
			.success
	);
});
export type SdkScanPattern = z.infer<typeof sdkScanPatternSchema>;
export const sdkScanPatternsSchema = z.custom<readonly SdkScanPattern[]>(
	(value) =>
		Array.isArray(value) &&
		value.every((entry) => sdkScanPatternSchema.safeParse(entry).success),
);
export type SdkScanPatterns = z.infer<typeof sdkScanPatternsSchema>;

/** Only the envelope is checked; arguments are evaluated lazily by the verb. */
export const sdkInnerComparisonSchema = z.custom<{
	readonly kind: string;
	readonly args: readonly unknown[];
}>((value) => {
	const parsed = sdkObjectSchema.safeParse(value);
	return (
		parsed.success &&
		sdkTextValueSchema.safeParse(Reflect.get(parsed.data, "kind")).success &&
		sdkListArgumentSchema.safeParse(Reflect.get(parsed.data, "args")).success
	);
});
export type SdkInnerComparison = z.infer<typeof sdkInnerComparisonSchema>;

/** Diagnostic labels retain JavaScript's typeof vocabulary, including null. */
export const sdkProducedTypeSchema = z.union([
	sdkNumberArgumentSchema.transform((): "number" => "number"),
	z.string().transform((): "string" => "string"),
	z.boolean().transform((): "boolean" => "boolean"),
	z.undefined().transform((): "undefined" => "undefined"),
	z.bigint().transform((): "bigint" => "bigint"),
	z.symbol().transform((): "symbol" => "symbol"),
	z.function().transform((): "function" => "function"),
	z.unknown().transform((): "object" => "object"),
]);
export type SdkProducedType = z.infer<typeof sdkProducedTypeSchema>;
