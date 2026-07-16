import {
	type AiReviewOutput,
	DEFAULT_WORKFLOW,
	type NormalizedEvent,
	RULE_CATALOG,
	type Verdict,
	type WorkflowDefinition,
} from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import { sql } from "drizzle-orm";
import type { Db } from "./client.ts";
import { events } from "./schema/events.ts";
import { moderationItems } from "./schema/moderation.ts";
import { runActions, runSteps, runs } from "./schema/runs.ts";
import * as insightServices from "./services/insights.ts";
import * as moderationServices from "./services/moderation.ts";
import * as repoServices from "./services/repos.ts";
import * as runServices from "./services/runs.ts";

/**
 * Dev/demo seeding (§13) — SHAPE-CORRECT fixtures over the real services, used
 * by BOTH the dev persona switcher (auto-created fixtures) and `dev:demo` (the
 * seeded story). Runs are constructed to satisfy the same contracts the worker
 * writes (snapshot, RuleResult step envelopes, public evidence + summary,
 * recorded-then-executed actions) — `@tripwire/db` cannot import core, so this
 * mirrors the shape rather than invoking the executor (§13 permits either).
 *
 * Everything lives under the `tripwire-demo/*` repo namespace and `demo-*` ids,
 * so `resetDemoData` can wipe ONLY seeded rows and never a real table.
 */

/** The one owner every seeded repo hangs under — the reset key. */
export const DEMO_OWNER = "tripwire-demo";
/** Seeded users carry this email domain, so reset finds them (auth owns them). */
export const DEMO_EMAIL_DOMAIN = "tripwire.demo";

const HOUR = 60 * 60 * 1000;

function demoRepoRef(name: string) {
	return {
		externalId: `demo-repo-${name}`,
		owner: DEMO_OWNER,
		name,
		fullName: `${DEMO_OWNER}/${name}`,
	};
}

/** A showcase workflow that runs ai-review then blocks — for the findings demo. */
const AI_REVIEW_WORKFLOW: WorkflowDefinition = {
	id: "ai-review@1",
	name: "ai review gate",
	version: 1,
	nodes: [
		{
			id: "trigger",
			type: "trigger",
			kinds: ["change-request.opened", "change-request.updated"],
		},
		{ id: "ai", type: "rule", ref: "ai-review@2", config: { maxSteps: 12 } },
		{ id: "gate", type: "gate", mode: "all-of" },
		{ id: "block", type: "action", action: "block" },
	],
	edges: [
		{ id: "e1", from: "trigger", to: "ai" },
		{ id: "e2", from: "ai", to: "gate" },
		{ id: "e3", from: "gate", to: "block", when: "fail" },
	],
};

interface Contributor {
	login: string;
	externalId: string;
	avatarUrl?: string;
}

function changeRequestEvent(input: {
	eventId: string;
	repo: { externalId: string; owner: string; name: string; fullName: string };
	actor: Contributor;
	number: number;
	title: string;
	headSha: string;
	at: Date;
}): NormalizedEvent {
	const iso = input.at.toISOString();
	return {
		id: input.eventId,
		forge: "github",
		deliveryId: `demo-${input.eventId}`,
		repo: {
			owner: input.repo.owner,
			name: input.repo.name,
			fullName: input.repo.fullName,
		},
		repoExternalId: input.repo.externalId,
		actor: input.actor,
		occurredAt: iso,
		receivedAt: iso,
		kind: "change-request.opened",
		changeRequest: {
			number: input.number,
			title: input.title,
			headSha: input.headSha,
			baseRef: "main",
			headRef: `contrib/${input.number}`,
			draft: false,
			url: `https://github.com/${input.repo.fullName}/pull/${input.number}`,
		},
	};
}

async function insertEvent(db: Db, normalized: NormalizedEvent): Promise<void> {
	if (normalized.kind !== "change-request.opened") {
		return;
	}
	await db.insert(events).values({
		id: normalized.id,
		forge: "github",
		deliveryId: normalized.deliveryId,
		rawKind: "pull_request",
		raw: {},
		receivedAt: new Date(normalized.receivedAt),
		kind: normalized.kind,
		repoFullName: normalized.repo.fullName,
		actorLogin: normalized.actor.login,
		subjectNumber: normalized.changeRequest.number,
		headSha: normalized.changeRequest.headSha,
		normalized,
		normalizedAt: new Date(normalized.receivedAt),
	});
}

/** A rule step's RuleResult envelope (what the executor produces per rule). */
function ruleStep(input: {
	nodeId: string;
	ref: string;
	passed: boolean;
	evidence: unknown;
	at: Date;
	publicEvidence?: unknown;
	summary?: string;
}): runServices.RecordStepInput {
	const [ruleId, version] = input.ref.split("@");
	const iso = input.at.toISOString();
	return {
		nodeId: input.nodeId,
		nodeKind: "rule",
		ruleRef: input.ref,
		status: input.passed ? "pass" : "fail",
		input: {},
		output: {
			ruleId,
			version: Number(version),
			status: "evaluated",
			passed: input.passed,
			evidence: input.evidence,
			evaluatedAt: iso,
		},
		publicEvidence: input.publicEvidence,
		summary: input.summary ?? null,
		startedAt: iso,
		finishedAt: iso,
		durationMs: 4,
	};
}

function nonRuleStep(input: {
	nodeId: string;
	nodeKind: string;
	status: string;
	at: Date;
}): runServices.RecordStepInput {
	const iso = input.at.toISOString();
	return {
		nodeId: input.nodeId,
		nodeKind: input.nodeKind,
		status: input.status,
		input: {},
		output: {},
		startedAt: iso,
		finishedAt: iso,
		durationMs: 1,
	};
}

async function backdateRun(db: Db, runId: string, at: Date): Promise<void> {
	await db.execute(
		sql`UPDATE runs SET created_at = ${at.toISOString()}, completed_at = ${at.toISOString()} WHERE id = ${runId}`,
	);
}

export interface SeedRunOptions {
	db: Db;
	repo: { externalId: string; owner: string; name: string; fullName: string };
	actor: Contributor;
	number: number;
	title: string;
	verdict: Verdict;
	/** Rule refs that FAILED (drive the block/review). Others pass. */
	failed?: string[];
	/** When set, adds an ai-review step with these findings (the showcase). */
	aiReview?: { output: AiReviewOutput };
	at: Date;
}

/**
 * One shape-correct run + its event, steps and actions. `needs_review` pauses
 * the run and opens a pending moderation item (the queue is a paused run, §6).
 */
export async function seedRun(opts: SeedRunOptions): Promise<string> {
	const { db, repo, actor, number, verdict, at } = opts;
	const headSha = `demo${number.toString().padStart(6, "0")}`;
	const eventId = `demo-evt-${repo.name}-${number}`;
	const normalized = changeRequestEvent({
		eventId,
		repo,
		actor,
		number,
		title: opts.title,
		headSha,
		at,
	});
	await insertEvent(db, normalized);

	const useAi = Boolean(opts.aiReview);
	const snapshot = useAi ? [AI_REVIEW_WORKFLOW] : [DEFAULT_WORKFLOW];
	const runId = await runServices.createRun(db, {
		eventId,
		repoFullName: repo.fullName,
		subjectNumber: number,
		headSha,
		snapshot,
		status: verdict === "needs_review" ? "paused" : "completed",
		verdict,
	});

	const steps: runServices.RecordStepInput[] = [
		nonRuleStep({ nodeId: "trigger", nodeKind: "trigger", status: "pass", at }),
	];
	const failed = new Set(opts.failed ?? []);

	if (useAi && opts.aiReview) {
		const output = opts.aiReview.output;
		steps.push(
			ruleStep({
				nodeId: "ai",
				ref: "ai-review@2",
				passed: output.verdict === "pass",
				evidence: { output, trace: { steps: output.findings.length } },
				publicEvidence: { output },
				summary: output.summary,
				at,
			}),
		);
	} else {
		const prng = mulberry32(0x5eed ^ number);
		const rng: SeedRng = {
			rint: (min, max) => Math.floor(prng() * (max - min + 1)) + min,
			pick: <T>(arr: readonly T[]): T =>
				arr[Math.floor(prng() * arr.length)] as T,
		};
		for (const node of DEFAULT_WORKFLOW.nodes) {
			if (node.type !== "rule") {
				continue;
			}
			const didFail = failed.has(node.ref);
			const proj = ruleProjection(node.ref, didFail, rng);
			steps.push(
				ruleStep({
					nodeId: node.id,
					ref: node.ref,
					passed: !didFail,
					evidence: proj.evidence,
					publicEvidence: proj.publicEvidence,
					summary: proj.summary ?? undefined,
					at,
				}),
			);
		}
	}

	const gateFailed = verdict !== "pass";
	steps.push(
		nonRuleStep({
			nodeId: "gate",
			nodeKind: "gate",
			status: gateFailed ? "fail" : "pass",
			at,
		}),
	);
	steps.push(
		nonRuleStep({
			nodeId: useAi ? "block" : "block",
			nodeKind: "action",
			status: gateFailed ? "pass" : "not-reached",
			at,
		}),
	);
	await runServices.recordSteps(db, runId, steps);

	// Actions: recorded first, then marked executed (the run's real discipline).
	const actionKinds =
		verdict === "block"
			? ["block", "comment", "set-check"]
			: verdict === "needs_review"
				? ["send-to-moderation", "comment", "set-check"]
				: ["comment", "set-check"];
	const rows = await runServices.recordActions(
		db,
		runId,
		actionKinds.map((kind) => ({
			kind,
			payload: {},
			idempotencyKey: `${kind}:${repo.fullName}#${number}`,
		})),
	);
	for (const row of rows) {
		await runServices.markActionExecuted(db, row.id, null);
	}

	if (verdict === "needs_review") {
		await moderationServices.createModerationItem(db, {
			runId,
			nodeId: "review",
		});
	}

	await backdateRun(db, runId, at);
	return runId;
}

const SPAMMER: Contributor = { login: "crypto-spammer", externalId: "3000" };

const DAY = 24 * HOUR;

/** A workflow that sends a change request to review (for needs_review runs). */
const REVIEW_WORKFLOW: WorkflowDefinition = {
	id: "review@1",
	name: "review gate",
	version: 1,
	nodes: [
		{
			id: "trigger",
			type: "trigger",
			kinds: ["change-request.opened", "change-request.updated"],
		},
		{
			id: "min-prs",
			type: "rule",
			ref: "min-merged-prs@1",
			config: { min: 1 },
		},
		{ id: "gate", type: "gate", mode: "any-of" },
		{ id: "review", type: "action", action: "send-to-moderation" },
	],
	edges: [
		{ id: "e1", from: "trigger", to: "min-prs" },
		{ id: "e2", from: "min-prs", to: "gate" },
		{ id: "e3", from: "gate", to: "review", when: "fail" },
	],
};

/** Recurring contributor pools — the mix a real active repo sees. */
const REGULARS: Contributor[] = [
	"ada-w",
	"linus-t",
	"grace-h",
	"rob-pike",
	"margaret-j",
	"dennis-r",
	"barbara-l",
	"donald-k",
	"edsger-d",
	"alan-k",
	"bjarne-s",
	"guido-v",
	"james-g",
	"katherine-j",
	"radia-p",
].map((login, i) => ({ login, externalId: String(2000 + i) }));

const OCCASIONALS: Contributor[] = Array.from({ length: 22 }, (_, i) => ({
	login: `contributor-${i + 1}`,
	externalId: String(4000 + i),
}));

const SPAMMERS: Contributor[] = [
	"crypto-spammer",
	"airdrop-bot",
	"free-nft-99",
	"pump-it-420",
	"moon-wallet",
	"token-drop",
	"defi-degen",
	"rug-puller",
	"shill-master",
	"gm-frens",
].map((login, i) => ({ login, externalId: String(3000 + i) }));

const NEWCOMERS: Contributor[] = [
	"first-timer",
	"new-here",
	"day-one",
	"just-joined",
	"hello-world",
	"drive-by",
].map((login, i) => ({ login, externalId: String(5000 + i) }));

const PASS_TITLES = [
	"fix: correct typo in README",
	"docs: clarify install steps",
	"test: cover the parser edge cases",
	"refactor: extract the config loader",
	"chore: bump dependencies",
	"fix: handle null repo in the loader",
	"feat: add --json output flag",
	"perf: memoize the rule registry",
	"fix: off-by-one in pagination",
	"docs: add a troubleshooting section",
	"test: snapshot the verdict comment",
	"ci: cache bun install between runs",
	"fix: respect NO_COLOR",
	"refactor: split the webhook parser",
	"feat: support glob paths in config",
	"fix: debounce the file watcher",
	"docs: document the rule catalog",
	"chore: drop the unused polyfill",
];
const REVIEW_TITLES = [
	"feat: add locale files for i18n",
	"large refactor of the core engine",
	"vendor a third-party api client",
	"feat: experimental plugin system",
	"add a new storage backend",
	"rewrite the queue consumer",
];

interface Reason {
	failed: string[];
	titles: string[];
	actors: Contributor[];
}
const BLOCK_REASONS: Reason[] = [
	{
		failed: ["crypto-address@1"],
		titles: [
			"add donation wallet to README",
			"update FUNDING.yml with an eth address",
			"support crypto tips",
			"add bitcoin address to sponsors",
		],
		actors: SPAMMERS,
	},
	{
		failed: ["honeypot@1"],
		titles: [
			"update CI workflow",
			"add release automation",
			"tweak the github action",
			"add a deploy workflow",
		],
		actors: [...SPAMMERS, ...NEWCOMERS],
	},
	{
		failed: ["account-age@1"],
		titles: [
			"URGENT please merge",
			"important update",
			"great project!! merge",
		],
		actors: NEWCOMERS,
	},
	{
		failed: ["max-files-changed@1"],
		titles: [
			"vendor the entire sdk",
			"import upstream wholesale",
			"add 400 generated files",
		],
		actors: [...OCCASIONALS, ...NEWCOMERS],
	},
	{
		failed: ["english-only@1"],
		titles: ["добавить функцию", "更新文档", "actualizar la configuración"],
		actors: [...NEWCOMERS, ...OCCASIONALS],
	},
];

/** Varied ai-review verdicts — findings across files, constitution voice. */
const AI_TEMPLATES: AiReviewOutput[] = [
	{
		verdict: "block",
		confidence: 0.94,
		summary:
			"workflow change exfiltrates an npm token and disables the origin allowlist.",
		findings: [
			{
				severity: "critical",
				file: ".github/workflows/release.yml",
				line: 34,
				note: "exfiltrates `secrets.NPM_TOKEN` to an external host on every push.",
			},
			{
				severity: "warn",
				file: "src/config/loader.ts",
				line: 88,
				note: "widens `allowedHosts` to `*` — disables the origin check.",
			},
			{
				severity: "info",
				file: "src/config/loader.ts",
				note: "unrelated formatting churn mixed into a security-sensitive diff.",
			},
		],
	},
	{
		verdict: "block",
		confidence: 0.88,
		summary: "adds a postinstall script that curls and pipes a remote payload.",
		findings: [
			{
				severity: "critical",
				file: "package.json",
				line: 12,
				note: "`postinstall` runs `curl … | sh` from an unpinned host.",
			},
			{
				severity: "warn",
				file: "scripts/setup.sh",
				line: 3,
				note: "downloads and executes a binary with no checksum.",
			},
		],
	},
	{
		verdict: "block",
		confidence: 0.91,
		summary: "obfuscated base64 blob decoded and eval'd at runtime.",
		findings: [
			{
				severity: "critical",
				file: "src/util/telemetry.ts",
				line: 47,
				note: "`eval(atob(…))` executes a decoded blob — classic loader.",
			},
			{
				severity: "warn",
				file: "src/util/telemetry.ts",
				line: 51,
				note: "beacons the decoded result to a hardcoded IP.",
			},
		],
	},
	{
		verdict: "needs_review",
		confidence: 0.55,
		summary: "broad dependency bump touches auth; worth a human glance.",
		findings: [
			{
				severity: "warn",
				file: "package.json",
				line: 20,
				note: "major bump of the auth library — check the migration notes.",
			},
			{
				severity: "info",
				file: "src/auth/session.ts",
				line: 14,
				note: "session cookie flags changed alongside the bump.",
			},
		],
	},
];

/** Protected paths honeypot points at (its public evidence carries `touched`). */
const HONEYPOT_PATHS = [
	".github/workflows/release.yml",
	".github/workflows/ci.yml",
	".github/workflows/deploy.yml",
	".github/workflows/publish.yml",
];
/** Crypto addresses + where found (its public evidence carries `matches`). */
const CRYPTO_MATCHES: { kind: string; value: string; location: string }[] = [
	{
		kind: "eth",
		value: "0x8f3b2a1c9d4e5f60718293a4b5c6d7e8f9012a3b",
		location: "README.md",
	},
	{
		kind: "eth",
		value: "0x1c0ffee254729296a45a3885639AC7E10F9d54979",
		location: "title",
	},
	{
		kind: "btc",
		value: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
		location: "FUNDING.yml",
	},
	{
		kind: "sol",
		value: "7Np41oeYqPefeNQEHSv1UDhYrehxin3NStELsSKCT4K2",
		location: "docs/sponsors.md",
	},
];
/** Non-latin title samples for english-only. */
const NON_LATIN_SAMPLES = [
	"добавить функцию",
	"更新文档",
	"テストを追加",
	"새 기능 추가",
];

interface SeedRng {
	rint: (min: number, max: number) => number;
	pick: <T>(arr: readonly T[]) => T;
}

function takeSome<T>(arr: readonly T[], n: number, rng: SeedRng): T[] {
	const copy = [...arr];
	const out: T[] = [];
	for (let k = 0; k < n && copy.length > 0; k++) {
		out.push(copy.splice(rng.rint(0, copy.length - 1), 1)[0] as T);
	}
	return out;
}

/**
 * The REAL §10 projection per rule — `evidence` (full, with thresholds),
 * `publicEvidence` (the allow-listed facts), and the plain-English `summary` —
 * mirroring core's `publicEvidence`/`summarize`. This is what the run page
 * renders: honeypot ⇒ touched files, crypto ⇒ matched addresses, the rest ⇒ the
 * summary. Shared by the year-long story and single-run seeds so EVERY run
 * (incl. the public one) reads real, never the fallback.
 */
export function ruleProjection(
	ref: string,
	failed: boolean,
	rng: SeedRng,
): { evidence: unknown; publicEvidence: unknown; summary: string | null } {
	const id = ref.split("@")[0];
	if (id === "account-age") {
		const age = failed ? rng.rint(0, 6) : rng.rint(30, 900);
		return {
			evidence: { accountAgeDays: age, minDays: 7 },
			publicEvidence: { accountAgeDays: age },
			summary: `your account is ${age} days old`,
		};
	}
	if (id === "crypto-address") {
		if (!failed) {
			return {
				evidence: { matches: [] },
				publicEvidence: { matches: [] },
				summary: "no crypto addresses found",
			};
		}
		const matches = takeSome(CRYPTO_MATCHES, rng.rint(1, 2), rng);
		const where = [...new Set(matches.map((m) => m.location))].join(", ");
		return {
			evidence: { matches },
			publicEvidence: { matches },
			summary: `it adds ${matches.length} crypto ${matches.length === 1 ? "address" : "addresses"} in ${where}`,
		};
	}
	if (id === "honeypot") {
		if (!failed) {
			return {
				evidence: { touched: [] },
				publicEvidence: { touched: [] },
				summary: null,
			};
		}
		const touched = takeSome(HONEYPOT_PATHS, rng.rint(1, 2), rng);
		return {
			evidence: { touched },
			publicEvidence: { touched },
			summary:
				touched.length === 1
					? "it touches a protected workflow file"
					: `it touches ${touched.length} protected paths`,
		};
	}
	if (id === "max-files-changed") {
		const filesChanged = failed ? rng.rint(201, 800) : rng.rint(1, 150);
		return {
			evidence: { filesChanged, max: 200 },
			publicEvidence: { filesChanged },
			summary: `this change touches ${filesChanged} ${filesChanged === 1 ? "file" : "files"}`,
		};
	}
	if (id === "english-only") {
		if (!failed) {
			return {
				evidence: {
					ratio: 0.02,
					lettersExamined: rng.rint(20, 80),
					sample: "",
				},
				publicEvidence: { ratio: 0.02, lettersExamined: 40, sample: "" },
				summary: null,
			};
		}
		const ev = {
			ratio: 0.72,
			lettersExamined: rng.rint(8, 30),
			sample: rng.pick(NON_LATIN_SAMPLES),
		};
		return {
			evidence: ev,
			publicEvidence: ev,
			summary: "the title isn't in latin script",
		};
	}
	if (id === "min-merged-prs") {
		const merged = failed ? 0 : rng.rint(1, 40);
		return {
			evidence: { mergedInRepo: merged, min: 1 },
			publicEvidence: { mergedInRepo: merged },
			summary:
				merged === 0
					? "you have no merged changes in this repo yet"
					: `you have ${merged} merged ${merged === 1 ? "change" : "changes"} in this repo`,
		};
	}
	return { evidence: { matched: failed }, publicEvidence: null, summary: null };
}

/**
 * Wipe one repo's seeded runs/events/moderation so re-seeding it is idempotent
 * WITHOUT touching other demo repos (a persona reseed must not nuke the rest).
 */
export async function resetRepoData(
	db: Db,
	repoFullName: string,
): Promise<void> {
	const repoRuns = sql`SELECT id FROM runs WHERE repo_full_name = ${repoFullName}`;
	await db.execute(
		sql`DELETE FROM moderation_items WHERE run_id IN (${repoRuns})`,
	);
	await db.execute(sql`DELETE FROM run_actions WHERE run_id IN (${repoRuns})`);
	await db.execute(sql`DELETE FROM run_steps WHERE run_id IN (${repoRuns})`);
	await db.execute(
		sql`DELETE FROM runs WHERE repo_full_name = ${repoFullName}`,
	);
	await db.execute(
		sql`DELETE FROM events WHERE repo_full_name = ${repoFullName} AND id LIKE ${"demo-evt-%"}`,
	);
}

type EventInsert = typeof events.$inferInsert;
type RunInsert = typeof runs.$inferInsert;
type StepInsert = typeof runSteps.$inferInsert;
type ActionInsert = typeof runActions.$inferInsert;
type ModInsert = typeof moderationItems.$inferInsert;

/** Small deterministic PRNG so the story is identical on every seed. */
function mulberry32(seed: number): () => number {
	let a = seed;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

async function bulkInsert<T>(
	db: Db,
	table: Parameters<Db["insert"]>[0],
	rows: T[],
): Promise<void> {
	for (let i = 0; i < rows.length; i += 400) {
		const chunk = rows.slice(i, i + 400);
		if (chunk.length > 0) {
			// biome-ignore lint/suspicious/noExplicitAny: heterogeneous insert tables
			await db.insert(table).values(chunk as any);
		}
	}
}

/**
 * A full year of realistic activity for one repo (§13.10) — this is what an
 * ACTIVE, ~year-old maintainer repo looks like: change requests every day
 * (weekday rhythm + occasional spam waves), a dense recent window so the Home
 * sparklines are alive, a realistic verdict mix from dozens of contributors,
 * varied ai-review findings, a real pending review queue, enabled rule configs,
 * and daily rollups across the whole year. Bulk-inserted for speed. Idempotent:
 * skips if the repo is already populated (reset first to reseed).
 */
export async function seedStory(
	db: Db,
	repo: {
		id: string;
		externalId: string;
		owner: string;
		name: string;
		fullName: string;
	},
	now: Date,
	opts: { days?: number } = {},
): Promise<void> {
	const existing = (
		await db.execute(
			sql`SELECT count(*)::int AS n FROM runs WHERE repo_full_name = ${repo.fullName}`,
		)
	).rows as { n: number }[];
	if (Number(existing[0]?.n ?? 0) > 0) {
		return; // already populated — a fast no-op for repeat logins
	}

	const days = opts.days ?? 365;
	const rnd = mulberry32(0x7317_c0de);
	const rint = (min: number, max: number) =>
		Math.floor(rnd() * (max - min + 1)) + min;
	const pick = <T>(arr: readonly T[]): T =>
		arr[Math.floor(rnd() * arr.length)] as T;
	const chance = (p: number) => rnd() < p;

	const eventRows: EventInsert[] = [];
	const runRows: RunInsert[] = [];
	const stepRows: StepInsert[] = [];
	const actionRows: ActionInsert[] = [];
	const modRows: ModInsert[] = [];

	const startOfToday = new Date(now);
	startOfToday.setHours(0, 0, 0, 0);

	// Weekday base volume (Sun..Sat) — weekdays busy, weekends quiet.
	const weekdayBase = [2, 7, 8, 8, 7, 6, 2];
	let pr = 1;
	let pending = 0;
	const MAX_PENDING = 7;

	const ruleStepRow = (
		runId: string,
		nodeId: string,
		ref: string,
		passed: boolean,
		evidence: unknown,
		at: Date,
		extra?: { publicEvidence?: unknown; summary?: string },
	): StepInsert => {
		const [, version] = ref.split("@");
		const output = {
			ruleId: ref.split("@")[0],
			version: Number(version),
			status: "evaluated" as const,
			passed,
			evidence,
			evaluatedAt: at.toISOString(),
		};
		return {
			id: generateId(),
			runId,
			nodeId,
			nodeKind: "rule",
			ruleId: ref,
			status: passed ? "pass" : "fail",
			input: {},
			output,
			evidence: output,
			publicEvidence: extra?.publicEvidence ?? null,
			summary: extra?.summary ?? null,
			startedAt: at,
			finishedAt: at,
			durationMs: rint(2, 60),
		};
	};
	const plainStepRow = (
		runId: string,
		nodeId: string,
		nodeKind: string,
		status: string,
		at: Date,
	): StepInsert => ({
		id: generateId(),
		runId,
		nodeId,
		nodeKind,
		status,
		input: {},
		output: {},
		startedAt: at,
		finishedAt: at,
		durationMs: rint(1, 8),
	});

	const rng: SeedRng = { rint, pick };

	for (let d = days - 1; d >= 0; d--) {
		const dayStart = new Date(startOfToday.getTime() - d * DAY);
		const weekday = dayStart.getDay();
		let count = (weekdayBase[weekday] ?? 5) + rint(-2, 3);
		// Occasional spam wave.
		if (chance(0.05)) {
			count += rint(8, 20);
		}
		// Dense recent window so the 24h sparklines look alive.
		if (d <= 1) {
			count += rint(10, 18);
		}
		count = Math.max(0, count);

		for (let i = 0; i < count; i++) {
			// Spread across the working day; clamp today's runs to before `now`.
			let at = new Date(
				dayStart.getTime() + rint(7, 22) * HOUR + rint(0, 59) * 60_000,
			);
			if (at.getTime() > now.getTime()) {
				at = new Date(now.getTime() - rint(1, 90) * 60_000);
			}

			// Verdict mix: mostly pass, a quarter block, a tenth to review.
			const roll = rnd();
			const verdict: Verdict =
				roll < 0.62 ? "pass" : roll < 0.9 ? "block" : "needs_review";

			const runId = generateId();
			const number = pr++;
			const eventId = `demo-evt-${repo.name}-${number}`;
			const headSha = `demo${number.toString(16).padStart(8, "0")}`;
			const useAi =
				verdict !== "pass" && chance(verdict === "block" ? 0.14 : 0.25);
			const aiTemplate = useAi
				? pick(
						AI_TEMPLATES.filter((t) =>
							verdict === "block"
								? t.verdict === "block"
								: t.verdict === "needs_review",
						),
					)
				: null;

			let actor: Contributor;
			let title: string;
			const failed: string[] = [];
			if (verdict === "pass") {
				actor = chance(0.7) ? pick(REGULARS) : pick(OCCASIONALS);
				title = pick(PASS_TITLES);
			} else if (verdict === "block") {
				const reason = pick(BLOCK_REASONS);
				actor = pick(reason.actors);
				title = pick(reason.titles);
				failed.push(...reason.failed);
				if (chance(0.25)) {
					failed.push("account-age@1");
				}
			} else {
				actor = chance(0.5) ? pick(NEWCOMERS) : pick(OCCASIONALS);
				title = pick(REVIEW_TITLES);
			}

			const snapshot =
				verdict === "needs_review"
					? [REVIEW_WORKFLOW]
					: useAi
						? [AI_REVIEW_WORKFLOW]
						: [DEFAULT_WORKFLOW];

			// Decide the pending queue: only recent reviews stay pending, capped.
			const stayPending =
				verdict === "needs_review" && d <= 4 && pending < MAX_PENDING;
			if (stayPending) {
				pending++;
			}
			const status =
				verdict === "needs_review" && stayPending ? "paused" : "completed";

			const normalized = changeRequestEvent({
				eventId,
				repo,
				actor,
				number,
				title,
				headSha,
				at,
			});
			eventRows.push({
				id: eventId,
				forge: "github",
				deliveryId: `demo-${eventId}`,
				rawKind: "pull_request",
				raw: {},
				receivedAt: at,
				kind: "change-request.opened",
				repoFullName: repo.fullName,
				actorLogin: actor.login,
				subjectNumber: number,
				headSha,
				normalized,
				normalizedAt: at,
			});
			runRows.push({
				id: runId,
				eventId,
				repoFullName: repo.fullName,
				subjectNumber: number,
				headSha,
				status,
				verdict,
				workflowSnapshot: snapshot,
				createdAt: at,
				completedAt: status === "completed" ? at : null,
			});

			// Steps: trigger → rules → gate → terminal action.
			stepRows.push(plainStepRow(runId, "trigger", "trigger", "pass", at));
			if (aiTemplate) {
				stepRows.push(
					ruleStepRow(
						runId,
						"ai",
						"ai-review@2",
						aiTemplate.verdict === "pass",
						{
							output: aiTemplate,
							trace: { findings: aiTemplate.findings.length },
						},
						at,
						{
							publicEvidence: { output: aiTemplate },
							summary: aiTemplate.summary,
						},
					),
				);
			} else if (verdict === "needs_review") {
				const proj = ruleProjection("min-merged-prs@1", true, rng);
				stepRows.push(
					ruleStepRow(
						runId,
						"min-prs",
						"min-merged-prs@1",
						false,
						proj.evidence,
						at,
						{
							publicEvidence: proj.publicEvidence,
							summary: proj.summary ?? undefined,
						},
					),
				);
			} else {
				const failedSet = new Set(failed);
				for (const node of DEFAULT_WORKFLOW.nodes) {
					if (node.type !== "rule") {
						continue;
					}
					const didFail = failedSet.has(node.ref);
					const proj = ruleProjection(node.ref, didFail, rng);
					stepRows.push(
						ruleStepRow(runId, node.id, node.ref, !didFail, proj.evidence, at, {
							publicEvidence: proj.publicEvidence,
							summary: proj.summary ?? undefined,
						}),
					);
				}
			}
			const gateFailed = verdict !== "pass";
			stepRows.push(
				plainStepRow(runId, "gate", "gate", gateFailed ? "fail" : "pass", at),
			);
			const terminal =
				verdict === "block"
					? "block"
					: verdict === "needs_review"
						? "review"
						: "block";
			stepRows.push(
				plainStepRow(
					runId,
					terminal,
					"action",
					gateFailed ? "pass" : "not-reached",
					at,
				),
			);

			// Actions — recorded then executed (final state for the seed).
			const kinds =
				verdict === "block"
					? ["block", "comment", "set-check"]
					: verdict === "needs_review"
						? ["send-to-moderation", "comment", "set-check"]
						: ["comment", "set-check"];
			for (const kind of kinds) {
				actionRows.push({
					id: generateId(),
					runId,
					kind,
					payload: {},
					idempotencyKey: `${kind}:${repo.fullName}#${number}`,
					status: "executed",
					recordedAt: at,
					executedAt: at,
				});
			}

			if (verdict === "needs_review") {
				const decided = !stayPending;
				modRows.push({
					id: generateId(),
					runId,
					nodeId: "review",
					status: decided ? (chance(0.5) ? "approved" : "denied") : "pending",
					createdAt: at,
					// A decision must never land in the future — else the item counts in
					// queue depth at `now` but not the pending count, breaking §13.10
					// (series[23] === value).
					decidedAt: decided
						? new Date(
								Math.min(at.getTime() + rint(1, 20) * HOUR, now.getTime()),
							)
						: null,
				});
			}
		}
	}

	await bulkInsert(db, events, eventRows);
	await bulkInsert(db, runs, runRows);
	await bulkInsert(db, runSteps, stepRows);
	await bulkInsert(db, runActions, actionRows);
	await bulkInsert(db, moderationItems, modRows);

	// Enable the baseline rules (+ ai-review) so the Rules page shows real config.
	for (const rule of RULE_CATALOG) {
		await repoServices.upsertRuleConfig(db, repo.id, {
			ruleId: rule.ruleId,
			version: rule.version,
			enabled: true,
			config: rule.defaultConfig,
		});
	}

	// Daily rollups across the whole window — analytics history.
	for (let d = 0; d < days; d++) {
		await insightServices.computeDailyRollups(
			db,
			isoDay(new Date(startOfToday.getTime() - d * DAY)),
		);
	}
}

/** A single public (non-private) run a stranger can read — persona 6. */
export async function seedPublicRun(
	db: Db,
	repo: { externalId: string; owner: string; name: string; fullName: string },
	now: Date,
): Promise<string> {
	await resetRepoData(db, repo.fullName);
	return await seedRun({
		db,
		repo,
		actor: SPAMMER,
		number: 7,
		title: "add wallet address to funding",
		verdict: "block",
		failed: ["crypto-address@1"],
		at: new Date(now.getTime() - 2 * HOUR),
	});
}

function isoDay(d: Date): string {
	return d.toISOString().slice(0, 10);
}

/** Ensure a demo repo exists (idempotent), returning its id + ref. */
export async function ensureDemoRepo(
	db: Db,
	name: string,
	opts: { private?: boolean; installationId?: string | null } = {},
): Promise<{
	id: string;
	externalId: string;
	owner: string;
	name: string;
	fullName: string;
}> {
	const ref = demoRepoRef(name);
	const id = await repoServices.ensureRepo(db, {
		...ref,
		private: opts.private ?? false,
		installationId: opts.installationId ?? null,
	});
	// §4 — the demo showcases a WORKING gate; arm every demo repo so dev:demo
	// shows the story, not the "not armed" call-to-action.
	await repoServices.setRepoArmed(db, id, true);
	return { id, ...ref };
}

/**
 * Wipe ONLY seeded rows — the `tripwire-demo/*` repos, their runs/steps/actions/
 * moderation/rollups/config, the `demo-*` events, and the `@tripwire.demo`
 * users (auth cascades their sessions/accounts/installations). Never touches a
 * real table's real rows.
 */
export async function resetDemoData(db: Db): Promise<void> {
	const demoRuns = sql`SELECT id FROM runs WHERE repo_full_name LIKE ${`${DEMO_OWNER}/%`}`;
	const demoRepos = sql`SELECT id FROM repos WHERE full_name LIKE ${`${DEMO_OWNER}/%`}`;
	await db.execute(
		sql`DELETE FROM moderation_items WHERE run_id IN (${demoRuns})`,
	);
	await db.execute(sql`DELETE FROM run_actions WHERE run_id IN (${demoRuns})`);
	await db.execute(sql`DELETE FROM run_steps WHERE run_id IN (${demoRuns})`);
	await db.execute(
		sql`DELETE FROM runs WHERE repo_full_name LIKE ${`${DEMO_OWNER}/%`}`,
	);
	await db.execute(
		sql`DELETE FROM rollups_daily WHERE repo_id IN (${demoRepos})`,
	);
	await db.execute(
		sql`DELETE FROM rule_configs WHERE repo_id IN (${demoRepos})`,
	);
	await db.execute(
		sql`DELETE FROM workflow_definitions WHERE repo_id IN (${demoRepos})`,
	);
	await db.execute(sql`DELETE FROM events WHERE id LIKE ${"demo-evt-%"}`);
	// Auth cascades sessions/accounts/forge_identities/memberships.
	await db.execute(
		sql`DELETE FROM "user" WHERE email LIKE ${`%@${DEMO_EMAIL_DOMAIN}`}`,
	);
	await db.execute(
		sql`DELETE FROM repos WHERE full_name LIKE ${`${DEMO_OWNER}/%`}`,
	);
}
