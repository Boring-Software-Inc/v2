const AI_AGENT_PREFIXES: Array<[string, string]> = [
	["claude", "claude"],
	["codex", "codex"],
	["cursor", "cursor"],
	["copilot-cli", "copilot"],
	["github-copilot-cli", "copilot"],
	["copilot", "vscode"],
	["vscode", "vscode"],
	["devin", "devin"],
	["windsurf", "devin"],
	["cascade", "devin"],
	["grok", "grok"],
	["opencode", "opencode"],
	["gemini", "gemini"],
	["antigravity", "antigravity"],
	["agy", "antigravity"],
	["amp", "amp"],
	["droid", "droid"],
	["factory", "droid"],
	["cline", "cline"],
	["kilo", "kilo"],
	["kiro", "kiro"],
	["zed", "zed"],
	["goose", "goose"],
	["muse", "muse"],
];

export function hostAgentId(env: NodeJS.ProcessEnv): string | null {
	const declared = env.AI_AGENT?.toLowerCase();
	if (declared) {
		const match = AI_AGENT_PREFIXES.find(([prefix]) =>
			declared.startsWith(prefix),
		);
		if (match) {
			return match[1];
		}
	}
	if (env.CLAUDECODE === "1") {
		return "claude";
	}
	if (env.CODEX_SANDBOX || env.CODEX_THREAD_ID) {
		return "codex";
	}
	if (env.GEMINI_CLI === "1") {
		return "gemini";
	}
	if (env.CURSOR_AGENT) {
		return "cursor";
	}
	return declared ? "unknown" : null;
}
