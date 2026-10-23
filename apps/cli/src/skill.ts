import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SKILL_NAME } from "#/config";
import type { MergeOutcome } from "#/json-config";
import SKILL_MD from "../skills/tripwire-get-started/SKILL.md" with {
	type: "text",
};

export function skillPath(skillsDir: string): string {
	return join(skillsDir, SKILL_NAME, "SKILL.md");
}

export function writeSkill(skillsDir: string): MergeOutcome {
	const path = skillPath(skillsDir);
	let current: string | null = null;
	try {
		current = readFileSync(path, "utf8");
	} catch {
		current = null;
	}
	if (current === SKILL_MD) {
		return "unchanged";
	}
	mkdirSync(join(skillsDir, SKILL_NAME), { recursive: true });
	const temp = `${path}.tripwire-${process.pid}.tmp`;
	writeFileSync(temp, SKILL_MD);
	renameSync(temp, path);
	return current === null ? "added" : "updated";
}
