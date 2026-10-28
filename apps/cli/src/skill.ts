import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { IS_STAGING, SKILL_NAME, WORKFLOWS_SKILL_NAME } from "#/config";
import type { MergeOutcome } from "#/json-config";
import SKILL_MD from "../skills/tripwire-get-started/SKILL.md" with {
	type: "text",
};
import WORKFLOWS_SKILL_MD from "../skills/tripwire-workflows/SKILL.md" with {
	type: "text",
};

function skillBody(body: string): string {
	if (!IS_STAGING) {
		return body;
	}
	return body
		.replace(
			"description: ",
			"description: For explicit Tripwire staging requests only. ",
		)
		.replaceAll("tripwire-get-started", SKILL_NAME)
		.replaceAll("tripwire-workflows", WORKFLOWS_SKILL_NAME)
		.replaceAll("@tripwire-sh/cli", "@tripwire-sh/cli@staging")
		.replaceAll("mcp login tripwire", "mcp login tripwire-staging")
		.replaceAll("mcp auth tripwire", "mcp auth tripwire-staging")
		.replaceAll("https://app.tripwire.sh", "https://staging.tripwire.sh")
		.replaceAll("`tripwire ", "`npx @tripwire-sh/cli@staging ")
		.replaceAll("`tripwire` CLI", "`npx @tripwire-sh/cli@staging` CLI")
		.replace(
			/\n(# [^\n]+)\n/,
			"\n$1\n\nUse only the tripwire-staging MCP server and the staging CLI for this skill.\n",
		);
}

const SKILLS = [
	{ name: SKILL_NAME, body: skillBody(SKILL_MD) },
	{ name: WORKFLOWS_SKILL_NAME, body: skillBody(WORKFLOWS_SKILL_MD) },
] as const;

export function skillPath(
	skillsDir: string,
	name: string = SKILL_NAME,
): string {
	return join(skillsDir, name, "SKILL.md");
}

function writeOne(skillsDir: string, name: string, body: string): MergeOutcome {
	const path = skillPath(skillsDir, name);
	let current: string | null = null;
	try {
		current = readFileSync(path, "utf8");
	} catch {
		current = null;
	}
	if (current === body) {
		return "unchanged";
	}
	mkdirSync(join(skillsDir, name), { recursive: true });
	const temp = `${path}.tripwire-${process.pid}.tmp`;
	writeFileSync(temp, body);
	renameSync(temp, path);
	return current === null ? "added" : "updated";
}

/** Writes every bundled skill; the outcome is the strongest change made. */
export function writeSkill(skillsDir: string): MergeOutcome {
	const outcomes = SKILLS.map((skill) =>
		writeOne(skillsDir, skill.name, skill.body),
	);
	if (outcomes.includes("added")) {
		return "added";
	}
	return outcomes.includes("updated") ? "updated" : "unchanged";
}
