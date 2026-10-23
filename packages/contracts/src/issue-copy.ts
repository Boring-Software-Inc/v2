import type { z } from "zod";

const ZOD_DEFAULT_TEXT =
	/^(Too (small|big)|Invalid (input|option|string|number|key|element|value)|Unrecognized key)/;

const TYPE_WORDS = new Map([
	["number", "a number"],
	["int", "a whole number"],
	["string", "text"],
	["boolean", "true or false"],
	["array", "a list"],
	["object", "a group of settings"],
]);

function plural(count: number | bigint, word: string): string {
	return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function fieldName(path: readonly PropertyKey[]): string {
	return path.map(String).join(".");
}

function productText(issue: z.core.$ZodIssue, field: string): string | null {
	switch (issue.code) {
		case "too_small": {
			if (issue.origin === "array" || issue.origin === "set") {
				return `${field} needs at least ${plural(issue.minimum, "item")}`;
			}
			if (issue.origin === "string") {
				return issue.minimum === 1
					? `${field} cannot be empty`
					: `${field} needs at least ${plural(issue.minimum, "character")}`;
			}
			return issue.inclusive === false
				? `${field} must be more than ${issue.minimum}`
				: `${field} must be ${issue.minimum} or more`;
		}
		case "too_big": {
			if (issue.origin === "array" || issue.origin === "set") {
				return `${field} can have at most ${plural(issue.maximum, "item")}`;
			}
			if (issue.origin === "string") {
				return `${field} can be at most ${plural(issue.maximum, "character")}`;
			}
			return issue.inclusive === false
				? `${field} must be less than ${issue.maximum}`
				: `${field} must be ${issue.maximum} or less`;
		}
		case "invalid_type":
			return /received undefined/.test(issue.message)
				? `${field} is missing`
				: `${field} must be ${TYPE_WORDS.get(issue.expected) ?? issue.expected}`;
		case "invalid_value":
			return issue.values.length === 1
				? `${field} must be ${String(issue.values[0])}`
				: `${field} must be one of ${issue.values.map(String).join(", ")}`;
		case "invalid_format":
			return `${field} is not a valid ${issue.format}`;
		case "invalid_union":
			return `${field} is not in a form Tripwire can read`;
		case "unrecognized_keys":
			return `${issue.keys.join(", ")} ${issue.keys.length === 1 ? "is not a setting" : "are not settings"}`;
		default:
			return null;
	}
}

/** One validation issue as a product sentence that names its field. */
export function fieldIssueSentence(issue: z.core.$ZodIssue): string {
	const field = fieldName(issue.path);
	if (ZOD_DEFAULT_TEXT.test(issue.message)) {
		const text = productText(issue, field || "This setting");
		if (text) {
			return text;
		}
	}
	return field ? `${field}: ${issue.message}` : issue.message;
}
