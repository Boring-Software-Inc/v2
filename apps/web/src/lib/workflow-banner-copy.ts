/**
 * The Rules-page explainer copy for workflow-only execution (§6). Names the
 * rules the workflow owns (up to three, then "and N more" so at least the first
 * names stay visible at any count), and states plainly that everything else is
 * off. No em dashes, short declarative sentences, concrete nouns.
 */
export function workflowBannerCopy(ownedRuleNames: string[]): string {
	if (ownedRuleNames.length === 0) {
		return "Your workflow decides what runs. Add rules to it to turn them on.";
	}
	return `Your workflow runs ${joinNames(ownedRuleNames)}. Rules outside it stay off until you add them.`;
}

function joinNames(names: string[]): string {
	if (names.length <= 3) {
		if (names.length === 1) {
			return names[0] as string;
		}
		if (names.length === 2) {
			return `${names[0]} and ${names[1]}`;
		}
		return `${names[0]}, ${names[1]}, and ${names[2]}`;
	}
	const shown = names.slice(0, 3);
	return `${shown.join(", ")}, and ${names.length - shown.length} more`;
}
