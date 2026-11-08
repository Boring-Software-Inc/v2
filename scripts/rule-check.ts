/**
 * rule-check CLI — a thin wrapper over checkRule/listRules (rule-check.core.ts).
 * Dev tool: holds DB + forge credentials by design, never shipped.
 *
 *   bun run rule-check --list --repo owner/name
 *   bun run rule-check --rule <ref|name> --pr owner/name#123
 *   bun run rule-check --rule "spam forks" --pr owner/name#123 --json
 */
import { createDb } from "@tripwire/db";
import { z } from "zod";
import {
	type CheckResult,
	checkRule,
	checkWorkflow,
	listRules,
} from "./rule-check.core.ts";

const textArgSchema = z.string();

function parseArgs(argv: string[]) {
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

function parsePr(input: string) {
	const match = input.match(/^(.+)#(\d+)$/);
	if (!match?.[1] || !match[2]) {
		throw new Error(`--pr must look like owner/name#123, got "${input}"`);
	}
	return { repo: match[1], number: Number(match[2]) };
}

function parseSubject(input: string) {
	const match = input.match(/^([\w.-]+\/[\w.-]+)#([1-9]\d*)$/);
	if (!match?.[1] || !match[2] || !Number.isSafeInteger(Number(match[2]))) {
		throw new Error("Use a GitHub target like owner/name#123.");
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
			const repo = textArgSchema.safeParse(args.repo);
			if (!repo.success || !repo.data) {
				throw new Error("--list requires --repo owner/name");
			}
			const rules = await listRules({ db, repo: repo.data });
			const width = Math.max(...rules.map((r) => r.ref.length));
			for (const rule of rules) {
				console.log(
					`${rule.ref.padEnd(width)}  ${rule.name}  [${rule.source}]`,
				);
			}
			return;
		}
		if (args.workflow !== undefined) {
			const workflowId = z.uuid().parse(args.workflow);
			const kind = args.issue === undefined ? "pr" : "issue";
			if (
				(args.pr === undefined) === (args.issue === undefined) ||
				args.rule !== undefined
			) {
				throw new Error(
					"Use --workflow <id> with exactly one of --issue or --pr.",
				);
			}
			const { repo, number } = parseSubject(textArgSchema.parse(args[kind]));
			const result = await checkWorkflow({
				db,
				repo,
				number,
				kind,
				workflowId,
			});
			process.stdout.write(`${JSON.stringify(result, null, 2)}
`);
			return;
		}
		const ruleRef = textArgSchema.safeParse(args.rule);
		const prArg = textArgSchema.safeParse(args.pr);
		if (!ruleRef.success || !ruleRef.data || !prArg.success) {
			console.error(
				"usage:\n  rule-check --list --repo owner/name\n  rule-check --rule <ref|name> --pr owner/name#123 [--json]\n  rule-check --workflow <id> --issue owner/name#123\n  rule-check --workflow <id> --pr owner/name#123",
			);
			process.exitCode = 1;
			return;
		}
		const { repo, number } = parsePr(prArg.data);
		const result = await checkRule({
			db,
			repo,
			ruleRef: ruleRef.data,
			pr: number,
		});
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
