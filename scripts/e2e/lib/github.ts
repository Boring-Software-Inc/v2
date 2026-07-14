import { join } from "node:path";
import { CHECK_NAME } from "@tripwire/forge-github";
import { $ } from "bun";
import type { HarnessConfig } from "./config.ts";

/**
 * The GitHub-facing driver — every scenario reaches real GitHub through here,
 * and every assertion reads real GitHub state via `gh api` (never our DB, for
 * the forge-facing checks). Extracted from `test:lifecycle` so the ~18
 * scenarios share one account/fork/push/poll/cleanup surface.
 */

export interface Comment {
	id: number;
	body: string;
	user: { login: string };
}
export interface Review {
	id: number;
	state: string;
	body: string;
	user: { login: string };
}
export interface CheckRun {
	name?: string;
	status: string;
	conclusion: string | null;
	head_sha: string;
	output?: { title?: string | null; summary?: string | null };
}

const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

/** A file write in a commit; `null` deletes the path. */
export type FileEdit = Record<string, string | null>;

export interface PushTarget {
	/** `origin` (base repo) or `fork` (the contributor's fork). */
	remote: "origin" | "fork";
	branch: string;
}

export class GitHub {
	private readonly config: HarnessConfig;
	private cloned = false;
	private forkRepo: string | null = null;
	/** Branches opened this run, tagged with the remote they live on — for cleanup. */
	private readonly openedBranches: PushTarget[] = [];
	private readonly openedPrs: number[] = [];

	constructor(config: HarnessConfig) {
		this.config = config;
		$.throws(true);
	}

	get repo(): string {
		return this.config.repo;
	}

	private git(...args: string[]): Promise<unknown> {
		return $`git ${args}`.cwd(this.config.workdir).quiet();
	}

	async api<T>(path: string): Promise<T> {
		return (await $`gh api ${path} --paginate`.quiet().json()) as T;
	}

	/** The active gh account's login. */
	async activeAccount(): Promise<string> {
		return (await $`gh api user --jq .login`.quiet().text()).trim();
	}

	async as(user: string): Promise<void> {
		await $`gh auth switch --user ${user}`.quiet();
	}

	/** Ensure the contributor's fork exists and return its `owner/name`. */
	async ensureFork(user: string): Promise<string> {
		if (this.forkRepo) {
			return this.forkRepo;
		}
		await $`gh repo fork ${this.config.repo} --clone=false`.nothrow().quiet();
		this.forkRepo = `${user}/${this.config.repoName}`;
		await $`git remote remove fork`.cwd(this.config.workdir).nothrow().quiet();
		await $`git remote add fork https://github.com/${this.forkRepo}.git`
			.cwd(this.config.workdir)
			.quiet();
		return this.forkRepo;
	}

	async ensureClone(): Promise<void> {
		if (this.cloned) {
			return;
		}
		const check = await $`test -d ${this.config.workdir}/.git`
			.nothrow()
			.quiet();
		if (check.exitCode !== 0) {
			await $`gh repo clone ${this.config.repo} ${this.config.workdir}`.quiet();
		}
		this.cloned = true;
	}

	async resolveBase(): Promise<string> {
		if (this.config.base) {
			return this.config.base;
		}
		return (
			await $`gh repo view ${this.config.repo} --json defaultBranchRef --jq .defaultBranchRef.name`.text()
		).trim();
	}

	/** Cut a fresh branch off the current base, discarding any prior local state. */
	async freshBranch(base: string, branch: string): Promise<void> {
		await this.ensureClone();
		await $`git fetch origin ${base}`.cwd(this.config.workdir).quiet();
		await this.git("checkout", base);
		await this.git("reset", "--hard", `origin/${base}`);
		await $`git branch -D ${branch}`.cwd(this.config.workdir).nothrow().quiet();
		await this.git("checkout", "-b", branch);
	}

	/**
	 * Apply file edits, commit, and push to the target — returns the pushed SHA.
	 * `--force` covers the force-push scenario (rewritten history on the same ref).
	 */
	async commit(
		edits: FileEdit,
		message: string,
		target: PushTarget,
		options: { force?: boolean } = {},
	): Promise<string> {
		for (const [path, content] of Object.entries(edits)) {
			const full = join(this.config.workdir, path);
			if (content === null) {
				await $`rm -f ${full}`.quiet();
				await this.git("add", "-A", path);
			} else {
				await Bun.write(full, content);
				await this.git("add", path);
			}
		}
		await this.git("commit", "-m", message);
		const args = ["push", target.remote, target.branch];
		if (options.force) {
			args.push("--force");
		}
		await this.git(...args);
		this.track(target);
		return (await $`git rev-parse HEAD`.cwd(this.config.workdir).text()).trim();
	}

	/** A no-op commit — the `test:run` "just make a run land" trigger. */
	async emptyCommit(message: string, target: PushTarget): Promise<string> {
		await $`git commit --allow-empty -m ${message}`
			.cwd(this.config.workdir)
			.quiet();
		await this.git("push", target.remote, target.branch);
		this.track(target);
		return (await $`git rev-parse HEAD`.cwd(this.config.workdir).text()).trim();
	}

	private track(target: PushTarget): void {
		if (
			!this.openedBranches.some(
				(t) => t.remote === target.remote && t.branch === target.branch,
			)
		) {
			this.openedBranches.push(target);
		}
	}

	/** Find-or-create a PR for the head ref; idempotent. Returns its number. */
	async openPr(input: {
		base: string;
		headRef: string;
		branch: string;
		title: string;
		body: string;
		draft?: boolean;
	}): Promise<number> {
		const draftFlag = input.draft ? ["--draft"] : [];
		const created =
			await $`gh pr create --repo ${this.config.repo} --base ${input.base} --head ${input.headRef} --title ${input.title} --body ${input.body} ${draftFlag}`
				.nothrow()
				.text();
		let pr = Number(created.trim().split("/").pop());
		if (!Number.isInteger(pr)) {
			pr = (await this.findOpenPr(input.branch)) ?? Number.NaN;
		}
		if (Number.isInteger(pr)) {
			this.openedPrs.push(pr);
		}
		return pr;
	}

	async findOpenPr(branch: string): Promise<number | null> {
		const out =
			await $`gh pr list --repo ${this.config.repo} --state open --head ${branch} --json number --jq ${".[].number"}`
				.nothrow()
				.quiet()
				.text();
		const n = Number(out.trim().split("\n")[0]);
		return Number.isInteger(n) ? n : null;
	}

	async prHead(pr: number): Promise<string> {
		const data = await this.api<{ head: { sha: string } }>(
			`/repos/${this.config.repo}/pulls/${pr}`,
		);
		return data.head.sha;
	}

	async prState(pr: number): Promise<{ state: string; draft: boolean }> {
		return await this.api<{ state: string; draft: boolean }>(
			`/repos/${this.config.repo}/pulls/${pr}`,
		);
	}

	async comments(pr: number): Promise<Comment[]> {
		return this.api<Comment[]>(
			`/repos/${this.config.repo}/issues/${pr}/comments?per_page=100`,
		);
	}

	async reviews(pr: number): Promise<Review[]> {
		return this.api<Review[]>(
			`/repos/${this.config.repo}/pulls/${pr}/reviews?per_page=100`,
		);
	}

	async checkRunsOn(sha: string): Promise<CheckRun[]> {
		const data = await this.api<{ check_runs: CheckRun[] }>(
			`/repos/${this.config.repo}/commits/${sha}/check-runs?check_name=${CHECK_NAME}`,
		);
		return data.check_runs;
	}

	private async completedCheck(sha: string): Promise<CheckRun | null> {
		const runs = await this.checkRunsOn(sha);
		return runs.find((r) => r.status === "completed") ?? null;
	}

	/** Wait for GitHub's head to equal `sha` and a COMPLETED tripwire check on it. */
	async waitForVerdict(
		pr: number,
		sha: string,
		onProgress?: (message: string) => void,
	): Promise<CheckRun> {
		const start = Date.now();
		let lastLog = 0;
		while (Date.now() - start < this.config.timeoutMs) {
			const head = await this.prHead(pr);
			if (head === sha) {
				const run = await this.completedCheck(sha);
				if (run) {
					return run;
				}
			}
			const now = Date.now();
			if (onProgress && now - lastLog >= 15_000) {
				const elapsed = Math.round((now - start) / 1000);
				onProgress(
					head === sha
						? `waiting for a completed \`${CHECK_NAME}\` on ${sha.slice(0, 7)} (${elapsed}s)`
						: `waiting for GitHub head ${sha.slice(0, 7)} (now ${head.slice(0, 7)}, ${elapsed}s)`,
				);
				lastLog = now;
			}
			await sleep(this.config.pollMs);
		}
		const diagnosis = await this.diagnose(pr, sha);
		throw new Error(
			`no completed \`${CHECK_NAME}\` check for ${sha.slice(0, 7)} within ${this.config.timeoutMs / 1000}s — is the worker up, and the pusher non-exempt (fork mode / TRIPWIRE_DISABLE_EXEMPTION)?\n  ${diagnosis.join("\n  ")}`,
		);
	}

	/**
	 * Assert the ABSENCE of a run — for exempt actors (org member/maintainer) the
	 * worker skips entirely. Returns true when no tripwire check appears in the
	 * window. A shorter wait than a verdict: absence can't be polled to completion.
	 */
	async expectNoRun(sha: string, windowMs = 30_000): Promise<boolean> {
		const start = Date.now();
		while (Date.now() - start < windowMs) {
			const runs = await this.checkRunsOn(sha);
			if (runs.length > 0) {
				return false;
			}
			await sleep(this.config.pollMs);
		}
		return true;
	}

	async closePr(pr: number): Promise<void> {
		await $`gh pr close ${pr} --repo ${this.config.repo}`.nothrow().quiet();
	}

	async reopenPr(pr: number): Promise<void> {
		await $`gh pr reopen ${pr} --repo ${this.config.repo}`.nothrow().quiet();
	}

	async readyForReview(pr: number): Promise<void> {
		await $`gh pr ready ${pr} --repo ${this.config.repo}`.nothrow().quiet();
	}

	async editPrTitle(pr: number, title: string): Promise<void> {
		await $`gh pr edit ${pr} --repo ${this.config.repo} --title ${title}`
			.nothrow()
			.quiet();
	}

	/** Diagnostic dump when a wait fails — exactly what GitHub sees. */
	async diagnose(pr: number, expected: string): Promise<string[]> {
		const lines: string[] = [];
		try {
			const head = await this.prHead(pr);
			lines.push(
				`github head ${head.slice(0, 7)} · expected ${expected.slice(0, 7)}${head === expected ? "" : "  ← MISMATCH (push not registered?)"}`,
			);
			const runs = await this.checkRunsOn(head);
			lines.push(
				runs.length === 0
					? "no tripwire check on that SHA — worker down, webhook 401, wrong tunnel, or the pusher is exempt without fork mode / TRIPWIRE_DISABLE_EXEMPTION"
					: `checks: ${runs.map((r) => `${r.status}/${r.conclusion ?? "—"}`).join(", ")}`,
			);
		} catch (error) {
			lines.push(`(diagnostic read failed: ${String(error)})`);
		}
		return lines;
	}

	/** Close every PR opened this run and delete its branches — idempotent. */
	async cleanup(): Promise<void> {
		for (const pr of this.openedPrs) {
			await this.closePr(pr);
		}
		for (const target of this.openedBranches) {
			await $`git push ${target.remote} --delete ${target.branch}`
				.cwd(this.config.workdir)
				.nothrow()
				.quiet();
		}
		this.openedPrs.length = 0;
		this.openedBranches.length = 0;
	}
}

export const hasMarker = (body: string, marker: string): boolean =>
	body.includes(marker);
