/**
 * `bun run scripts/post-deploy.ts <main|staging>` — runs after every push to
 * main or staging (.github/workflows/post-deploy.yml). On 2026-11-27 a
 * promotion took prod down for about 30 minutes, and nothing noticed:
 *
 * 1. Waits for Unkey to finish deploying this commit, and fails if any app's
 *    deploy failed.
 * 2. Watches the live site for 10 minutes. A check that fails three rounds in
 *    a row fails the run.
 * 3. Only then stops the deployments this one replaced. Unkey keeps them
 *    running after a deploy, and each holds its own database connections;
 *    three generations of every app is what ran prod's database out.
 *
 *   GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_SHA   from Actions.
 *   UNKEY_DEPLOY_KEY  a root key that may only read and stop tripwire's
 *                     deployments. Without it, step 3 is skipped with a warning.
 */

export type Branch = "main" | "staging";

interface Replaced {
	apps: readonly string[];
	environment: string;
	/** Preview environments hold every branch; only this one's deploys are replaced. */
	branch?: string;
}

interface Target {
	webUrl: string;
	apiUrl: string;
	/** Staging's worker sleeps when idle, so its queue alerts would flap. */
	queuesRequired: boolean;
	replaced: readonly Replaced[];
}

const APPS = ["api", "worker", "web", "mcp"] as const;

export const TARGETS = {
	main: {
		webUrl: "https://app.tripwire.sh",
		apiUrl: "https://api.tripwire.sh",
		queuesRequired: true,
		replaced: [{ apps: APPS, environment: "production" }],
	},
	staging: {
		webUrl: "https://staging.tripwire.sh",
		apiUrl: "https://staging.api.tripwire.sh",
		queuesRequired: false,
		replaced: [
			{ apps: ["api-staging", "worker-staging"], environment: "production" },
			{ apps: APPS, environment: "preview", branch: "staging" },
		],
	},
} satisfies Record<Branch, Target>;

export interface CommitStatus {
	context: string;
	state: "pending" | "success" | "failure" | "error";
}

/** Where Unkey's deploys of a commit stand, from the commit's statuses. */
export function unkeyDeployState(
	statuses: readonly CommitStatus[],
): "none" | "pending" | "failed" | "done" {
	const unkey = statuses.filter((s) => s.context.startsWith("Unkey / "));
	if (unkey.length === 0) return "none";
	if (unkey.some((s) => s.state === "failure" || s.state === "error"))
		return "failed";
	if (unkey.some((s) => s.state === "pending")) return "pending";
	return "done";
}

export interface Deployment {
	id: string;
	status: string;
	isCurrent: boolean;
	environment: string;
	createdAt: number;
	git?: { branch?: string; commitSha?: string };
}

/**
 * The running deployments older than the one serving: in a production
 * environment the current one, and in a preview environment, which serves no
 * single one, this branch's latest deploy of `sha`. Never a newer one, so a
 * newer push or a rollout started by hand while this runs is left alone.
 */
export function replacedDeployments(
	deployments: readonly Deployment[],
	replaced: Replaced,
	sha: string,
): Deployment[] {
	const running = deployments.filter(
		(d) =>
			d.status === "ready" &&
			d.environment === replaced.environment &&
			(!replaced.branch || d.git?.branch === replaced.branch),
	);
	const serving = replaced.branch
		? running
				.filter((d) => d.git?.commitSha === sha)
				.sort((a, b) => b.createdAt - a.createdAt)[0]
		: running.find((d) => d.isCurrent);
	if (!serving) return [];
	return running.filter((d) => d.createdAt < serving.createdAt);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function commitStatuses(): Promise<CommitStatus[]> {
	const res = await fetch(
		`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/commits/${process.env.GITHUB_SHA}/status?per_page=100`,
		{
			headers: {
				authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
				accept: "application/vnd.github+json",
			},
		},
	);
	if (!res.ok) throw new Error(`GitHub statuses: HTTP ${res.status}`);
	const body = (await res.json()) as { statuses: CommitStatus[] };
	return body.statuses;
}

/** Step 1. Returns false when this commit deployed nothing (no watched path changed). */
async function waitForUnkey(): Promise<boolean> {
	const deadline = Date.now() + 25 * 60_000;
	const noneDeadline = Date.now() + 10 * 60_000;
	let settledRounds = 0;
	while (Date.now() < deadline) {
		const state = unkeyDeployState(await commitStatuses());
		if (state === "failed") fail("an Unkey deploy of this commit failed");
		if (state === "none" && Date.now() > noneDeadline) {
			log("Unkey deployed nothing for this commit");
			return false;
		}
		// Unkey posts each app's status as it starts, so wait for a quiet round.
		settledRounds = state === "done" ? settledRounds + 1 : 0;
		if (settledRounds >= 3) {
			log("Unkey finished deploying");
			return true;
		}
		await sleep(20_000);
	}
	fail("Unkey was still deploying after 25 minutes");
}

interface Check {
	name: string;
	required: boolean;
	run(): Promise<string | null>;
}

function checks(target: Target): Check[] {
	const get = (url: string) =>
		fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15_000) });
	return [
		{
			name: `${target.webUrl}/login`,
			required: true,
			run: async () => {
				const res = await get(`${target.webUrl}/login`);
				return res.status === 200 ? null : `HTTP ${res.status}`;
			},
		},
		{
			name: `${target.apiUrl}/healthz`,
			required: true,
			run: async () => {
				const res = await get(`${target.apiUrl}/healthz`);
				const body = (await res.json().catch(() => null)) as {
					ok?: boolean;
				} | null;
				return res.status === 200 && body?.ok === true
					? null
					: `HTTP ${res.status}`;
			},
		},
		{
			name: `${target.apiUrl}/healthz/queues`,
			required: target.queuesRequired,
			run: async () => {
				const res = await get(`${target.apiUrl}/healthz/queues`);
				const body = (await res.json().catch(() => null)) as {
					firing?: string[];
				} | null;
				return res.status === 200
					? null
					: `HTTP ${res.status}, firing: ${body?.firing?.join(", ") || "?"}`;
			},
		},
	];
}

/** Step 2. */
async function watchSite(target: Target): Promise<void> {
	const list = checks(target);
	const streaks = new Map<string, number>();
	const rounds = 20;
	for (let round = 1; round <= rounds; round++) {
		for (const check of list) {
			const problem = await check.run().catch((error: Error) => error.message);
			const streak = problem ? (streaks.get(check.name) ?? 0) + 1 : 0;
			streaks.set(check.name, streak);
			if (!problem) continue;
			const line = `${check.name}: ${problem} (${streak} in a row)`;
			if (check.required && streak >= 3) fail(line);
			log(`${check.required ? "::warning::" : ""}${line}`);
		}
		if (round < rounds) await sleep(30_000);
	}
	log("the site stayed up for 10 minutes");
}

interface ListDeploymentsRequest {
	project: string;
	app: string;
	environment: string;
	status: string[];
	limit: number;
}

interface StopDeploymentRequest {
	deploymentId: string;
}

async function unkey<T>(
	endpoint: string,
	body: ListDeploymentsRequest | StopDeploymentRequest,
): Promise<T> {
	const res = await fetch(`https://api.unkey.com/v2/${endpoint}`, {
		method: "POST",
		headers: {
			authorization: `Bearer ${process.env.UNKEY_DEPLOY_KEY}`,
			"content-type": "application/json",
		},
		body: JSON.stringify(body),
	});
	if (!res.ok) throw new Error(`Unkey ${endpoint}: HTTP ${res.status}`);
	return (await res.json()) as T;
}

/** Step 3. */
async function stopReplaced(target: Target): Promise<void> {
	if (!process.env.UNKEY_DEPLOY_KEY) {
		log(
			"::warning::UNKEY_DEPLOY_KEY is not set, so the replaced deployments are still running and holding database connections",
		);
		return;
	}
	const sha = process.env.GITHUB_SHA ?? "";
	for (const replaced of target.replaced) {
		for (const app of replaced.apps) {
			const { data } = await unkey<{ data: Deployment[] }>(
				"deployments.listDeployments",
				{
					project: "tripwire",
					app,
					environment: replaced.environment,
					status: ["ready"],
					limit: 100,
				},
			);
			for (const deployment of replacedDeployments(data, replaced, sha)) {
				await unkey("deployments.stopDeployment", {
					deploymentId: deployment.id,
				});
				log(
					`stopped ${app} ${deployment.id} (${deployment.git?.commitSha?.slice(0, 8) ?? "?"})`,
				);
			}
		}
	}
}

function log(line: string): void {
	process.stdout.write(`${line}\n`);
}

function fail(line: string): never {
	process.stdout.write(`::error::${line}\n`);
	process.exit(1);
}

if (import.meta.main) {
	const branch = process.argv[2];
	if (branch !== "main" && branch !== "staging")
		fail(`expected main or staging, got ${branch}`);
	const target = TARGETS[branch];
	const deployed = await waitForUnkey();
	await watchSite(target);
	if (deployed) await stopReplaced(target);
}
