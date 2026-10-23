import { SKILL_NAME } from "#/config";

const RUN_CODE = /^([a-z0-9_-]+)#([A-Za-z0-9]{10})$/;

export const DEFAULT_PROMPT = `Use the \`${SKILL_NAME}\` skill for this project.`;

export function buildPrompt(instruction?: string): string {
	const trimmed = instruction?.trim();
	if (!trimmed) {
		return DEFAULT_PROMPT;
	}
	const match = trimmed.match(RUN_CODE);
	if (match) {
		return [
			"Please help me set up Tripwire.",
			"",
			`org slug: ${match[1]}`,
			`run code: ${match[2]}`,
		].join("\n");
	}
	return `Tripwire was just installed. ${trimmed}`;
}
