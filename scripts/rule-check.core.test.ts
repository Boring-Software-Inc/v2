import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";

const ROOT = resolve(import.meta.dir, "..");

function declarations(file: string, names: readonly string[]): string {
	const text = readFileSync(resolve(ROOT, file), "utf8");
	const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
	return names
		.map((name) => {
			const matches = source.statements.filter((statement) => {
				if (ts.isFunctionDeclaration(statement)) {
					return statement.name?.text === name;
				}
				return (
					ts.isVariableStatement(statement) &&
					statement.declarationList.declarations.some(
						(declaration) => declaration.name.getText(source) === name,
					)
				);
			});
			if (matches.length !== 1) {
				throw new Error(`${file}: expected one declaration for ${name}`);
			}
			return matches.map((statement) => statement.getText(source)).join("\n");
		})
		.join("\n");
}

function control(source: string): void {
	const code = new Bun.Transpiler({ loader: "ts" }).transformSync(`
		import assert from "node:assert/strict";
		globalThis.fetch = () => { throw new Error("network forbidden in tooling control"); };
		${source}
	`);
	const result = spawnSync(
		process.execPath,
		["--no-env-file", "--eval", code],
		{
			cwd: ROOT,
			encoding: "utf8",
			timeout: 10_000,
			env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: "/tmp" },
		},
	);
	expect(result.error).toBeUndefined();
	expect(result.status, result.stderr).toBe(0);
	expect(result.stdout).toBe("");
}

describe("rule-check CLI pure declarations", () => {
	test("keeps argument consumption, PR number conversion, errors and prototype keys", () => {
		control(`
			import { z } from "zod";
			${declarations("scripts/rule-check.ts", ["textArgSchema", "parseArgs", "parsePr"])}
			assert.deepEqual(parseArgs(["ignored", "--list", "--repo", "a/b", "--json"]),
				{ list: true, repo: "a/b", json: true });
			assert.deepEqual(parseArgs(["--rule", "--json", "--pr"]), { rule: "--json", pr: "" });
			assert.deepEqual(parseArgs(["--constructor", "legacy", "--toString", "value"]),
				{ constructor: "legacy", toString: "value" });
			assert.equal(Object.getPrototypeOf(parseArgs(["--__proto__", "ignored"])), Object.prototype);
			assert.deepEqual(parsePr("a/b#00012"), { repo: "a/b", number: 12 });
			assert.equal(parsePr("a/b#" + "9".repeat(400)).number, Infinity);
			assert.throws(() => parsePr("bad"), { message: '--pr must look like owner/name#123, got "bad"' });
			assert.equal(textArgSchema.safeParse(true).success, false);
			assert.equal(textArgSchema.safeParse(undefined).success, false);
			assert.equal(textArgSchema.safeParse("").success, true);
		`);
	});

	test("keeps exact evaluated and skipped formatting including signal details", () => {
		control(`
			${declarations("scripts/rule-check.ts", ["formatResult"])}
			const base = { name: "Age", ref: "account-age@1", source: "built-in",
				status: "evaluated", passed: true, signals: [], degradedReads: [], evidence: null };
			assert.equal(formatResult(base), 'rule:   Age  \\u0060account-age@1\\u0060  [built-in]\\n\\nstatus: evaluated - PASS\\n\\nevidence: null');
			assert.equal(formatResult({ ...base, passed: false }), 'rule:   Age  \\u0060account-age@1\\u0060  [built-in]\\n\\nstatus: evaluated - FAIL\\n\\nevidence: null');
			assert.equal(formatResult({ ...base, status: "skipped", signals: [
				{ id: "age", resolved: true, value: 7 }, { id: "other", resolved: false }
			], degradedReads: ["diff", "profile"] }),
				'rule:   Age  \\u0060account-age@1\\u0060  [built-in]\\n\\nstatus: SKIPPED\\n\\n  SKIP REASON: (none given)\\n\\nsignals:\\n  age - resolved: 7\\n  other - UNAVAILABLE: (no reason)\\n\\ndegraded reads: diff, profile\\n\\nevidence: null');
			assert.ok(formatResult({ ...base, status: "skipped", skipReason: "missing", signals: [
				{ id: "other", resolved: false, reason: "denied" }
			] }).includes('SKIP REASON: missing\\n\\nsignals:\\n  other - UNAVAILABLE: denied'));
		`);
	});
});

describe("rule-check core with local effect doubles", () => {
	test("skips invalid stored JSON before forge effects; keeps valid JSON and fallback precedence", () => {
		control(`
			import { jsonValueSchema, storedJsonValueSchema, RULE_CATALOG, resolveCatalog, ruleIdOf, customRuleRecordSchema } from "@tripwire/contracts";
			import { getErrorMessage } from "@tripwire/utils";
			import { SignalUnavailableError } from ${JSON.stringify(resolve(ROOT, "packages/sdk/src/index.ts"))};
			${declarations("scripts/rule-check.core.ts", ["loadCatalog", "resolveRef", "checkRule"])}
			let stored = { minDays: 5 };
			let catalogRows = [];
			let forgeCalls = 0;
			let seenDefinition;
			let configReads = 0;
			let output = { status: "evaluated", passed: true, evidence: { days: 9 } };
			const githubForge = { produces: {
				"local.number": () => 7,
				"local.unavailable": () => { throw new SignalUnavailableError("producer unavailable"); },
				"local.error": () => { throw new Error("producer error"); },
			} };
			const lookups = [];
			const repoServices = {
				getRepoByFullName: async (...args) => { lookups.push(args); return { id: "repo" }; },
				listCustomRules: async () => catalogRows,
				listRuleConfigs: async () => { configReads++; return [{ ruleId: "account-age", config: stored }]; },
			};
			const logger = {};
			const buildForge = () => { forgeCalls++; return { reads: {}, signalHttp: {} }; };
			const fetchPrEvent = async () => ({ kind: "change-request.opened" });
			const createForgeSignalCtx = () => ({});
			const customRuleSource = () => ({});
			const buildRuleContext = async () => ({ ctx: {}, degradedReads: ["profile"] });
			const makeEvaluator = () => () => { throw new Error("executor is a local double"); };
			const executeWorkflow = async ({ definition }) => {
				seenDefinition = definition;
				return { steps: output ? [{ nodeKind: "rule", output }] : [] };
			};
			const input = { db: {}, repo: "a/b", ruleRef: "account-age@1", pr: 2 };
			for (const invalid of [{ minDays: undefined }, { minDays: Infinity }, { minDays: NaN }]) {
			stored = invalid;
			assert.deepEqual(await checkRule(input), { ref: "account-age@1", name: RULE_CATALOG.find(e => e.ruleId === "account-age").name,
				source: "built-in", status: "skipped", passed: false, evidence: null,
				skipReason: "Stored rule config is not valid JSON.", signals: [], degradedReads: [] });
			assert.equal(forgeCalls, 0);
			}
			for (const value of [[], [1, "two"], "scalar", 0, false, { minDays: "wrong but JSON" },
				JSON.parse('{"__proto__":{"retained":true},"constructor":2}'),
				JSON.parse('{"nested":{"__proto__":{"retained":true}}}')]) {
				stored = value;
				const result = await checkRule(input);
				assert.equal(result.status, "evaluated");
				assert.deepEqual(result.evidence, { days: 9 });
				assert.deepEqual(result.degradedReads, ["profile"]);
				assert.equal(seenDefinition.nodes.find(n => n.type === "rule").config, value);
				assert.deepEqual(seenDefinition.nodes.find(n => n.type === "rule").config, value);
				assert.deepEqual(seenDefinition.nodes.map(n => n.type), ["trigger", "rule"]);
				assert.deepEqual(seenDefinition.edges, [{ id: "e1", from: "trigger", to: "rule" }]);
			}
			for (const value of [null, undefined]) {
				stored = value;
				await checkRule(input);
				assert.deepEqual(seenDefinition.nodes[1].config, RULE_CATALOG.find(e => e.ruleId === "account-age").defaultConfig);
			}
			assert.ok(lookups.every(args => args[1] === "a/b" && args[2] === "github"));
			const ownerLimitation = JSON.parse('{"__proto__":{}}');
			Object.defineProperty(ownerLimitation, "__proto__", { value: { invalid: undefined }, enumerable: true });
			assert.equal(jsonValueSchema.safeParse(ownerLimitation).success, true);
			assert.equal(storedJsonValueSchema.safeParse(ownerLimitation).success, false);
			for (const invalid of [undefined, Infinity, NaN, { nested: undefined }]) {
				const nested = JSON.parse('{"nested":{"__proto__":null}}');
				Object.defineProperty(nested.nested, "__proto__", { value: invalid, enumerable: true });
				stored = nested;
				const beforeInvalid = forgeCalls;
				assert.equal((await checkRule(input)).skipReason, "Stored rule config is not valid JSON.");
				assert.equal(forgeCalls, beforeInvalid);
			}
			assert.equal(storedJsonValueSchema.safeParse(null).success, true);
			const sentinel = new Error("config getter sentinel");
			const throwing = { get minDays() { throw sentinel; } };
			stored = throwing;
			const callsBeforeThrow = forgeCalls;
			await assert.rejects(checkRule(input), error => error === sentinel);
			assert.equal(forgeCalls, callsBeforeThrow);
			const priorConfigReads = configReads;
			for (const [id, expected] of [
				["local.number", { id: "local.number", resolved: true, value: 7 }],
				["local.unavailable", { id: "local.unavailable", resolved: false, reason: "producer unavailable" }],
				["local.error", { id: "local.error", resolved: false, reason: "producer error" }],
				["absent", { id: "absent", resolved: false }],
				["toString", { id: "toString", resolved: true, value: "[object Undefined]" }],
			]) {
				catalogRows = [{ id: "custom-local", name: "local", enabled: true,
					definition: { when: { id }, comparison: { kind: "atMost", args: [20] } } }];
				const result = await checkRule({ ...input, ruleRef: "custom-local@1" });
				assert.deepEqual(result.signals, [expected]);
				assert.deepEqual(seenDefinition.nodes[1].config, {});
			}
			assert.equal(configReads, priorConfigReads);
			catalogRows = [];
			stored = { minDays: 5 };
			output = { status: "skipped", passed: false, reason: "local skip", evidence: null };
			assert.equal((await checkRule(input)).skipReason, "local skip");
			output = undefined;
			assert.equal((await checkRule(input)).status, "skipped");
			assert.equal((await checkRule(input)).passed, false);
			assert.throws(() => resolveRef("missing", []), /unknown rule/);
			assert.throws(() => resolveRef("ambiguous", [
				{ ruleId: "first", version: 1, name: "ambiguous" },
				{ ruleId: "second", version: 1, name: "ambiguous" }
			]), /ambiguous name/);
		`);
	});

	test("keeps authenticated-client wiring and repo-scoped normalizer guard with local reads", () => {
		control(`
			${declarations("scripts/rule-check.core.ts", ["buildForge", "fetchPrEvent"])}
			const seen = [];
			class InstallationTokenCache {
				constructor(options) { seen.push(options); }
				getToken(id) { return Promise.resolve("local-token-" + id); }
			}
			class GithubReads { constructor(options) { this.options = options; } }
			class GithubHttp { constructor(options) { this.options = options; } }
			const repoServices = { getRepoByFullName: async (...args) => {
				seen.push(args); return { installationId: 42 };
			} };
			delete process.env.GITHUB_APP_ID;
			delete process.env.GITHUB_APP_PRIVATE_KEY;
			assert.throws(() => buildForge({}), /GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY are required/);
			process.env.GITHUB_APP_ID = "123";
			process.env.GITHUB_APP_PRIVATE_KEY = "local\\\\nkey";
			const forge = buildForge({});
			assert.equal(forge.signalHttp.options.appId, 123);
			assert.equal(await forge.reads.options.tokenFor("a/b"), "local-token-42");
			assert.deepEqual(seen[0], { appId: "123", privateKey: "local\\nkey" });
			assert.equal(seen[1][2], "github");
			let normalized = { repo: { fullName: "a/b" } };
			let raw;
			const normalizeWebhook = (value) => { raw = value; return normalized; };
			const pr = { base: { repo: { full_name: "a/b" } }, user: { login: "local" } };
			const http = { get: async (...args) => { assert.deepEqual(args, ["a/b", "/repos/a/b/pulls/2"]); return pr; } };
			assert.equal(await fetchPrEvent(http, "a/b", 2, "now"), normalized);
			assert.equal(raw.signature, "");
			assert.equal(raw.eventName, "pull_request");
			assert.deepEqual(JSON.parse(raw.body), { action: "opened", pull_request: pr, repository: pr.base.repo, sender: pr.user });
			normalized = null;
			await assert.rejects(fetchPrEvent(http, "a/b", 2, "now"), /could not normalize PR/);
			normalized = { kind: "installation.created" };
			await assert.rejects(fetchPrEvent(http, "a/b", 2, "now"), /could not normalize PR/);
		`);
	});
});

describe("harness workflow pure declarations", () => {
	test("preserves delivery polling assertions and fail-fast nullish payloads", () => {
		const file = "scripts/e2e/scenarios.ts";
		const text = readFileSync(resolve(ROOT, file), "utf8");
		const source = ts.createSourceFile(
			file,
			text,
			ts.ScriptTarget.Latest,
			true,
		);
		const loops: ts.ForOfStatement[] = [];
		function visit(node: ts.Node): void {
			if (
				ts.isForOfStatement(node) &&
				node.initializer.getText(source) === "const row" &&
				node.expression.getText(source) === "rows" &&
				node.statement
					.getText(source)
					.includes("deliveryFailureProjectionSchema")
			) {
				loops.push(node);
			}
			ts.forEachChild(node, visit);
		}
		visit(source);
		expect(loops).toHaveLength(1);
		control(`
			import { deliveryFailureProjectionSchema } from "@tripwire/contracts";
			import { Asserter } from ${JSON.stringify(resolve(ROOT, "scripts/e2e/lib/assert.ts"))};
			let asserter;
			function inspect(rows) {
				let failure = null;
				asserter = new Asserter();
				${loops.map((loop) => loop.getText(source)).join("\n")}
				return { failure, passed: asserter.passed, results: asserter.results };
			}
			const matching = { payload: { deliveryFailure: "blocked-destination" } };
			for (const value of [null, undefined]) {
				assert.throws(() => inspect([{ payload: value }, matching]), TypeError);
				assert.equal(asserter.results.length, 0);
			}
			const result = inspect([false, 0, "noise", [], {}, { deliveryFailure: 9 }].map(payload => ({ payload })).concat([matching]));
			assert.equal(result.failure, "blocked-destination");
			assert.equal(result.passed, true);
			assert.equal(result.results.length, 1);
			const leaked = inspect([{ payload: { deliveryFailure: "other", url: "169.254.169.254" } }]);
			assert.equal(leaked.passed, false);
			assert.equal(leaked.results[0].actual, "url leaked into the failure record");
			assert.equal(inspect([{ payload: { deliveryFailure: "blocked-destination", url: "169.254.169.254" } }]).passed, true);
			const sentinel = new Error("delivery getter sentinel");
			assert.throws(() => inspect([{ payload: { get deliveryFailure() { throw sentinel; } } }, matching]), error => error === sentinel);
			assert.equal(asserter.results.length, 0);
			assert.throws(() => inspect([{ payload: { deliveryFailure: "other", toJSON() { throw sentinel; } } }]), error => error === sentinel);
			assert.equal(asserter.results.length, 0);
		`);
	});

	test("keeps outcome mapping and block graph assertions", () => {
		control(`
			${declarations("scripts/e2e/lib/runner.ts", ["OUTCOME_TO_CONCLUSION"])}
			${declarations("scripts/e2e/scenarios.ts", ["ruleWorkflow", "gateWorkflow"])}
			assert.deepEqual(OUTCOME_TO_CONCLUSION, {
				pass: "success", block: "failure", "needs-review": "in_progress", degraded: "in_progress"
			});
			const config = { minDays: 36500 };
			const graph = ruleWorkflow("account-age", 1, config);
			assert.equal(graph.nodes[1].config, config);
			assert.deepEqual(graph.nodes.map(node => node.type), ["trigger", "rule", "action"]);
			assert.equal(graph.nodes[2].action, "block");
			assert.deepEqual(graph.edges, [{ id: "e1", from: "t", to: "r" }, { id: "e2", from: "r", to: "a", when: "fail" }]);
			for (const mode of ["all-of", "any-of", "not"]) {
				const gate = gateWorkflow(mode);
				assert.equal(gate.nodes.find(node => node.type === "gate").mode, mode);
				assert.equal(gate.nodes.filter(node => node.type === "rule").length, mode === "not" ? 1 : 2);
				assert.deepEqual(gate.edges.at(-1), { id: "e5", from: "g", to: "a", when: "fail" });
			}
		`);
	});
});

describe("eval pure declarations", () => {
	test("retains backtick matching and percentile behavior without model initialization", () => {
		control(`
			${declarations("scripts/eval/run.ts", ["backtickComplies", "pct", "diffText"])}
			assert.equal(backtickComplies(undefined, "token"), false);
			assert.equal(backtickComplies([], "token"), false);
			assert.equal(backtickComplies([{ note: "no token" }], "token"), false);
			assert.equal(backtickComplies([{ note: "check \\u0060token\\u0060" }], "a token here"), true);
			assert.equal(backtickComplies([{ note: "check \\u0060absent\\u0060 then \\u0060token\\u0060" }], "token"), false);
			assert.equal(backtickComplies([{}], "token"), false);
			assert.throws(() => backtickComplies([null], "token"), TypeError);
			assert.equal(diffText({ diff: [{ patch: "first" }, {}, { patch: "last" }] }), "first\\n\\nlast");
			assert.equal(pct([], 0.5), 0);
			assert.equal(pct([10, 1, 5, 20], 0.5), 10);
			assert.equal(pct([10, 1, 5, 20], 0.95), 20);
			assert.equal(pct([1], NaN), 0);
		`);
	});

	test("retains native Number coercion for eval env settings", () => {
		control(`
			const source = ${JSON.stringify(declarations("scripts/eval/config.ts", ["RUNS_PER_FIXTURE", "BUDGET_TOKENS"]))};
			const { Script, createContext } = await import("node:vm");
			const script = new Script(source.replaceAll("export ", "") + ";globalThis.values = [RUNS_PER_FIXTURE, BUDGET_TOKENS]");
			for (const value of [undefined, "", "0", "-2", "2.5", "bad", "Infinity"]) {
				const context = createContext({ process: { env: { EVAL_RUNS: value, EVAL_BUDGET_TOKENS: value } } });
				script.runInContext(context);
				assert.equal(context.values[0], Number(value ?? 3));
				assert.equal(context.values[1], Number(value ?? 3000000));
			}
		`);
	});
});

describe("backfill consumed loop with local rows", () => {
	test("keeps envelope/raw projection, per-row exceptions, dry mode and output accounting", () => {
		const file = "scripts/backfill-public-projection.ts";
		const text = readFileSync(resolve(ROOT, file), "utf8");
		const source = ts.createSourceFile(
			file,
			text,
			ts.ScriptTarget.Latest,
			true,
		);
		const loops = source.statements.filter(ts.isForOfStatement);
		expect(loops).toHaveLength(1);
		const loop = loops.map((statement) => statement.getText(source)).join("\n");
		control(`
			import { commentRuleEnvelopeSchema } from "@tripwire/contracts";
			${declarations(file, ["evidenceEnvelopeSchema"])}
			for (const DRY of [true, false]) {
				let updated = 0;
				let skipped = 0;
				const inner = { observed: 9 };
				const legacy = { observed: 8 };
				const stale = [
					{ id: "empty-id", ruleId: null, evidence: inner },
					{ id: "envelope", ruleId: "r", status: "pass", evidence: { evidence: inner } },
					{ id: "legacy", ruleId: "r", status: "fail", evidence: legacy },
					{ id: "malformed", ruleId: "r", evidence: "throw" },
					{ id: "no-projection", ruleId: "r", evidence: null },
				];
				const calls = [];
				const writes = [];
				const warnings = [];
				const console = { warn: value => warnings.push(value) };
				const runSteps = { id: "id" };
				const eq = (left, right) => [left, right];
				const db = { update: table => ({ set: values => ({ where: async predicate => { writes.push({ table, values, predicate }); } }) }) };
				const projectRulePublic = (rule, evidence, passed) => {
					calls.push({ rule, evidence, passed });
					if (evidence === "throw") throw new Error("shape mismatch");
					return evidence === null ? { publicEvidence: null, summary: null } : { publicEvidence: evidence, summary: "projected" };
				};
				${loop}
				assert.equal(calls[0].evidence, inner);
				assert.equal(calls[1].evidence, legacy);
				assert.equal(calls[0].passed, true);
				assert.equal(calls[1].passed, false);
				assert.equal(updated, 2);
				assert.equal(skipped, 1);
				assert.deepEqual(warnings, ["skip step malformed (r): shape mismatch"]);
				assert.equal(writes.length, DRY ? 0 : 2);
				if (!DRY) {
					assert.deepEqual(writes[0].values, { publicEvidence: inner, summary: "projected" });
					assert.deepEqual(writes[1].predicate, ["id", "legacy"]);
				}
			}
		`);
	});
});
