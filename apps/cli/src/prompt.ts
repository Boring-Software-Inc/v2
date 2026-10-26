import { parseSetupCommandArg, setupRunPrompt } from "@tripwire/contracts";
import { IS_STAGING, SKILL_NAME } from "#/config";

export const DEFAULT_PROMPT = `Use the \`${SKILL_NAME}\` skill for this project.`;

export function buildPrompt(instruction?: string): string {
	const trimmed = instruction?.trim();
	if (!trimmed) {
		return DEFAULT_PROMPT;
	}
	const run = parseSetupCommandArg(trimmed);
	if (run) {
		return IS_STAGING
			? `${DEFAULT_PROMPT}\n\n${setupRunPrompt(run)}`
			: setupRunPrompt(run);
	}
	return `${IS_STAGING ? `${DEFAULT_PROMPT}\n\n` : ""}Tripwire was just installed. ${trimmed}`;
}
