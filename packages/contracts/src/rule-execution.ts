export function ruleExecutes(
	_ref: string,
	explicitEnabled: boolean | undefined,
): boolean {
	return explicitEnabled ?? false;
}
