import {
	databuddyRuleSchema,
	type FlagOverrideChoice,
	type JsonValue,
	TRIPWIRE_RULE_FIELD,
} from "@tripwire/contracts";

function directUserRule(rule: JsonValue): {
	rule: Record<string, JsonValue>;
	field: "value" | "values" | "batchValues";
	users: string[];
} | null {
	if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
		return null;
	}
	const parsed = databuddyRuleSchema.safeParse(rule);
	if (!parsed.success || parsed.data.type !== "user_id") {
		return null;
	}
	const data = parsed.data;
	if (data.operator !== "equals" && data.operator !== "in") {
		return null;
	}
	if (data.batch && data.batchValues) {
		return { rule, field: "batchValues", users: data.batchValues };
	}
	if (!data.batch && data.operator === "in" && data.values) {
		return { rule, field: "values", users: data.values };
	}
	if (!data.batch && data.operator === "equals" && data.value !== undefined) {
		return { rule, field: "value", users: [data.value] };
	}
	return null;
}

/** Broad targeting and flag defaults are evaluated separately, not user overrides. */
export function getDatabuddyUserOverride(
	rules: readonly JsonValue[],
	userId: string,
): FlagOverrideChoice {
	for (const rule of rules) {
		const direct = directUserRule(rule);
		if (direct?.users.includes(userId)) {
			return direct.rule.enabled === true ? "on" : "off";
		}
	}
	return "default";
}

/** Change only explicit memberships of the requested users, retaining remote rules and metadata. */
export function updateDatabuddyUserOverrides(
	rules: readonly JsonValue[],
	overrides: readonly { userId: string; choice: FlagOverrideChoice }[],
): JsonValue[] {
	const targets = new Set(overrides.map((override) => override.userId));
	const retained: JsonValue[] = [];
	for (const rule of rules) {
		const direct = directUserRule(rule);
		if (!direct || !direct.users.some((id) => targets.has(id))) {
			retained.push(rule);
			continue;
		}
		const remaining = direct.users.filter((id) => !targets.has(id));
		if (remaining.length > 0) {
			retained.push({ ...direct.rule, [direct.field]: remaining });
		}
	}
	const added: JsonValue[] = [];
	for (const choice of ["off", "on"] as const) {
		const users = [
			...new Set(
				overrides.filter((o) => o.choice === choice).map((o) => o.userId),
			),
		].sort();
		if (users.length > 0) {
			added.push({
				type: "user_id",
				operator: "in",
				field: TRIPWIRE_RULE_FIELD[choice],
				values: users,
				enabled: choice === "on",
				batch: false,
			});
		}
	}
	return [...added, ...retained];
}
