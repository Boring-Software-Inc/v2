import { join } from "node:path";
import { CHECK_NAME } from "@tripwire/contracts";
import { $ } from "bun";
import type { HarnessConfig } from "./config.ts";

/**
 * The open-git driver — the counterpart to `github.ts`, with one hard rule:
 *
 *   IT NEVER CLOSES A PULL REQUEST.
 *
 * That is not tidiness. open-git has no closed-pull-request surface, so a
 * closed pull request cannot be inspected at all. The evidence is the point of
 * the run, so this driver has no close method to call by accident. You close
 * them by hand when you are done looking.
 *
 * The read half of open-git's api does not exist, so assertions go through the
 * one endpoint that does: `GET /commits/{sha}/checks`. That is also the whole
 * merge gate — `mergePullRequestForActor` consults checks and nothing else — so
 * asserting the check IS asserting the gate.
 */

export interface OpenGitConfig {
	/** owner/name of the sacrificial open-git repo. */
	repo: string;
	/** Base branch pull requests open against. */
	base: string;
	/** Personal access token (`ugp_`) with repo:write. */
	token: string;
	/** The token owner's username — git basic auth needs both halves. */
	username: string;
	/** Origin of the open-git instance. */
	origin: string;
	workdir: string;
	timeoutMs: number;
	pollMs: number;
}

export interface OpenGitCheck {
	name: string;
	status: "queued" | "running" | "success" | "failed" | "canceled";
	summary: string | null;
	detailsUrl: string | null;
	source: string;
}

export type FileEdit = Record<string, string | null>;

export class OpenGit {
	private readonly openedPrs: { number: number; url: string }[] = [];

	constructor(private readonly config: OpenGitConfig) {}

	/**
	 * Push url with basic-auth credentials inline. open-git's git gateway reads
	 * BOTH halves — `resolveBasicAuth` rejects an empty username — so the token
	 * alone is not enough.
	 */
	private get pushUrl(): string {
		// Keep the origin's own scheme. Forcing https would break a self-hosted
		// instance on http://localhost, and silently downgrading is worse.
		const [scheme, host] = this.config.origin.split("://");
		const user = encodeURIComponent(this.config.username);
		const token = encodeURIComponent(this.config.token);
		return `${scheme}://${user}:${token}@${host}/${this.config.repo}.git`;
	}

	private async git(...args: string[]): Promise<void> {
		await $`git ${args}`.cwd(this.config.workdir).quiet();
	}

	private async api(
		method: "GET" | "POST",
		path: string,
		body?: unknown,
	): Promise<unknown> {
		const res = await fetch(`${this.config.origin}${path}`, {
			method,
			headers: {
				authorization: `Bearer ${this.config.token}`,
				accept: "application/json",
				...(body === undefined ? {} : { "content-type": "application/json" }),
			},
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		const text = await res.text();
		if (!res.ok) {
			throw new Error(`${method} ${path} failed: ${res.status} ${text}`);
		}
		return text.length === 0 ? null : JSON.parse(text);
	}

	/** Clone once, reuse across runs — same shape as the github driver. */
	async prepare(): Promise<void> {
		const exists = await Bun.file(
			join(this.config.workdir, ".git", "HEAD"),
		).exists();
		if (!exists) {
			await $`git clone ${this.pushUrl} ${this.config.workdir}`.quiet();
		}
		await this.git("fetch", "origin", this.config.base);
		await this.git("checkout", this.config.base);
		await this.git("reset", "--hard", `origin/${this.config.base}`);
	}

	/** Fresh branch off the base, edits applied, pushed. Returns the head sha. */
	async pushBranch(input: {
		branch: string;
		edits: FileEdit;
		message: string;
	}): Promise<string> {
		await this.git("branch", "-D", input.branch).catch(() => undefined);
		await this.git("checkout", "-b", input.branch);
		for (const [path, content] of Object.entries(input.edits)) {
			const full = join(this.config.workdir, path);
			if (content === null) {
				await $`rm -f ${full}`.quiet();
				await this.git("add", "-A", path);
			} else {
				await Bun.write(full, content);
				await this.git("add", path);
			}
		}
		await this.git("commit", "-m", input.message);
		await this.git("push", this.pushUrl, input.branch, "--force");
		return (await $`git rev-parse HEAD`.cwd(this.config.workdir).text()).trim();
	}

	/** Open a pull request. Recorded so the run can print it, never close it. */
	async openPr(input: {
		branch: string;
		title: string;
		body: string;
	}): Promise<{ number: number; url: string }> {
		const created = (await this.api(
			"POST",
			`/api/v1/repos/${this.config.repo}/pulls`,
			{
				title: input.title,
				body: input.body,
				sourceBranch: input.branch,
				targetBranch: this.config.base,
			},
		)) as { number: number };
		const pr = {
			number: created.number,
			url: `${this.config.origin}/${this.config.repo}/pulls/${created.number}`,
		};
		this.openedPrs.push(pr);
		return pr;
	}

	async listChecks(sha: string): Promise<OpenGitCheck[]> {
		const data = (await this.api(
			"GET",
			`/api/v1/repos/${this.config.repo}/commits/${sha}/checks`,
		)) as { checks?: OpenGitCheck[] };
		return data.checks ?? [];
	}

	/**
	 * Poll until the `tripwire` check reaches a settled status. `running` is the
	 * pending state the worker writes while it evaluates, so it is not settled.
	 */
	async waitForCheck(
		sha: string,
		onPoll?: (message: string) => void,
	): Promise<OpenGitCheck | null> {
		const deadline = Date.now() + this.config.timeoutMs;
		while (Date.now() < deadline) {
			const checks = await this.listChecks(sha);
			const tripwire = checks.find((check) => check.name === CHECK_NAME);
			if (
				tripwire &&
				tripwire.status !== "queued" &&
				tripwire.status !== "running"
			) {
				return tripwire;
			}
			onPoll?.(
				tripwire
					? `check is ${tripwire.status}`
					: `no ${CHECK_NAME} check on ${sha.slice(0, 7)} yet`,
			);
			await Bun.sleep(this.config.pollMs);
		}
		return null;
	}

	/** Every pull request this run opened. All of them are still open. */
	openedPrUrls(): string[] {
		return this.openedPrs.map((pr) => pr.url);
	}
}

/**
 * open-git config off the same env surface as the github harness. Returns null
 * when the repo or credentials are absent, so the caller skips honestly rather
 * than failing halfway through a live run.
 */
export function loadOpenGitConfig(
	base: HarnessConfig,
	env: NodeJS.ProcessEnv = process.env,
): OpenGitConfig | null {
	const repo = env.OPEN_GIT_TEST_REPO;
	const token = env.OPEN_GIT_TEST_TOKEN;
	const username = env.OPEN_GIT_TEST_USER;
	if (!(repo && token && username)) {
		return null;
	}
	return {
		repo,
		base: env.OPEN_GIT_TEST_BASE ?? "main",
		token,
		username,
		origin: (env.OPEN_GIT_URL ?? "https://open-git.com").replace(/\/$/, ""),
		workdir: env.OPEN_GIT_TEST_WORKDIR ?? `${base.workdir}-opengit`,
		timeoutMs: base.timeoutMs,
		pollMs: base.pollMs,
	};
}
