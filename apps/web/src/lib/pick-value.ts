export function pickValue<const Value extends string>(
	values: readonly Value[],
	candidate: string,
): Value | undefined {
	return values.find((value) => value === candidate);
}
