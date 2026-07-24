/**
 * rule-check CLI — a thin wrapper over checkRule/listRules (rule-check.core.ts).
 * Dev tool: holds DB + forge credentials by design, never shipped.
 *
 *   bun run rule-check --list --repo owner/name
 *   bun run rule-check --rule <ref|name> --pr owner/name#123
 *   bun run rule-check --rule "spam forks" --pr owner/name#123 --json
 */
import { createDb } from "@tripwire/db";
import { type CheckResult, checkRule, listRules } from "./rule-check.core.ts";

function parseArgs(argv: string[]): Record<string, string | boolean> {
	const args: Record<string, string | boolean> = {};
	for (let i = 0; i < argv.length; i++) {
		const flag = argv[i];
		if (flag === "--list" || flag === "--json") {
			args[flag.slice(2)] = true;
		} else if (flag?.startsWith("--")) {
			args[flag.slice(2)] = argv[++i] ?? "";
		}
	}
	return args;
}

function parsePr(input: string): { repo: string; number: number } {
	const match = input.match(/^(.+)#(\d+)$/);
	if (!match?.[1] || !match[2]) {
		throw new Error(`--pr must look like owner/name#123, got "${input}"`);
	}
	return { repo: match[1], number: Number(match[2]) };
}

function formatResult(r: CheckResult): string {
	const lines = [`rule:   ${r.name}  \`${r.ref}\`  [${r.source}]`, ""];
	if (r.status === "skipped") {
		// The skip reason is the whole point — give it its own prominent line.
		lines.push(
			"status: SKIPPED",
			"",
			`  SKIP REASON: ${r.skipReason ?? "(none given)"}`,
			"",
		);
	} else {
		lines.push(`status: evaluated - ${r.passed ? "PASS" : "FAIL"}`, "");
	}
	if (r.signals.length > 0) {
		lines.push("signals:");
		for (const s of r.signals) {
			lines.push(
				s.resolved
					? `  ${s.id} - resolved: ${JSON.stringify(s.value)}`
					: `  ${s.id} - UNAVAILABLE: ${s.reason ?? "(no reason)"}`,
			);
		}
		lines.push("");
	}
	if (r.degradedReads.length > 0) {
		lines.push(`degraded reads: ${r.degradedReads.join(", ")}`, "");
	}
	lines.push(`evidence: ${JSON.stringify(r.evidence)}`);
	return lines.join("\n");
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const { db, pool } = createDb();
	try {
		if (args.list) {
			const repo = args.repo;
			if (typeof repo !== "string" || !repo) {
				throw new Error("--list requires --repo owner/name");
			}
			const rules = await listRules({ db, repo });
			const width = Math.max(...rules.map((r) => r.ref.length));
			for (const rule of rules) {
				console.log(
					`${rule.ref.padEnd(width)}  ${rule.name}  [${rule.source}]`,
				);
			}
			return;
		}
		const ruleRef = args.rule;
		const prArg = args.pr;
		if (typeof ruleRef !== "string" || !ruleRef || typeof prArg !== "string") {
			console.error(
				"usage:\n  rule-check --list --repo owner/name\n  rule-check --rule <ref|name> --pr owner/name#123 [--json]",
			);
			process.exitCode = 1;
			return;
		}
		const { repo, number } = parsePr(prArg);
		const result = await checkRule({ db, repo, ruleRef, pr: number });
		console.log(
			args.json ? JSON.stringify(result, null, 2) : formatResult(result),
		);
	} finally {
		await pool.end();
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
