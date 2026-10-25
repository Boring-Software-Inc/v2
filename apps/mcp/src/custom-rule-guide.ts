import { CUSTOM_SIGNALS, type CustomSignalDisplay } from "@tripwire/contracts";

function signalLine(signal: CustomSignalDisplay): string {
	const unit = signal.unit ? `, ${signal.unit}` : "";
	const window = signal.maxWindowHours
		? `, window up to ${signal.maxWindowHours}h`
		: "";
	return `${signal.id} (${signal.kind}${unit}${window})`;
}

export const CUSTOM_RULE_SIGNALS = CUSTOM_SIGNALS.map(signalLine).join("; ");

export const RELEASE_EXAMPLE = {
	intoRelease: {
		when: { id: "pr.targetBranch" },
		comparison: { kind: "noneOf", args: [["release"]] },
	},
	fromReleasePlease: {
		when: { id: "pr.sourceBranch" },
		comparison: {
			kind: "oneOf",
			args: [["release-please--branches--release"]],
		},
	},
} as const;

export const CUSTOM_RULE_GUIDE = [
	"Create or change a custom rule on a repo. Ask the user first. Leave out id to create a rule; pass its custom-... id to change it in place, so workflows that use it keep working. The reply has the rule's id and its sentence: show the sentence to the user.",
	"A new rule starts off unless enabled is true. A rule that is on and that no workflow uses runs by itself on every change request. To combine rules, keep them off and use them in tripwire.ts with customCheck(id), then validate and push the workflow.",
	"definition is { when: { id, transform? }, comparison: { kind, args } }. A rule reads one signal. It passes when the comparison holds and fails when it does not, so state what is allowed.",
	'Comparisons by signal kind. number: under, over, atLeast, atMost, equals with args [n]; between with [low, high]; oneOf, noneOf with [[n, ...]]. text: equals with ["exact"]; has with ["part"] (contains); containsAny with [["a", "b"]]; oneOf, noneOf with [["a", "b"]]. boolean: equals with [true] or [false]. textList: anyIn with [["a", "b"]] (some entry is one of them); noneMatch with [["docs/**", "*.md"]] (no entry matches a glob). timestamps: set transform { kind: "lastCount", window: "24h" } and compare as a number. not with [{ kind, args }] negates one comparison. Text compares are case sensitive. There is no starts-with and no regex, so never use has as a prefix check: it matches anywhere in the text.',
	'Text transforms trimmedLength, letterCount and nonLatinRatio turn a text signal into a number: transform { kind: "trimmedLength" }.',
	`Example, fail change requests into release: ${JSON.stringify(RELEASE_EXAMPLE.intoRelease)}.`,
	`Example, fail change requests into release unless they come from the release-please branch: save two rules, both off. A is the rule above. B lists the exact source branch names to allow: ${JSON.stringify(RELEASE_EXAMPLE.fromReleasePlease)}. Ask the user for the branch names; release-please names its branch release-please--branches--<target>. Then in tripwire.ts: workflow({ name: "Release branch", on: "change-request.opened", check: allOf(customCheck(A).fails, customCheck(B).fails), pass: [block()] }).`,
	`Signals: ${CUSTOM_RULE_SIGNALS}.`,
].join("\n\n");
