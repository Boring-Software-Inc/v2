import { createHmac } from "node:crypto";
import { join } from "node:path";
import { CHECK_NAME, type JsonValue } from "@tripwire/contracts";
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
	/** Origin of the open-git instance — the web app and the v1 api. */
	origin: string;
	/**
	 * Origin of the GIT gateway, which is a DIFFERENT host. open-git serves git
	 * from `git.<host>` on its own service; the web origin does not speak git and
	 * answers a clone with "repository not found".
	 */
	gitOrigin: string;
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

/**
 * The X-Hub-Signature-256 header value: HMAC SHA-256 of the RAW body.
 *
 * Deliberately NOT imported from @tripwire/forge-opengit. Nothing in the
 * monorepo root depends on that package, so importing it here would mean adding
 * a root workspace dependency, and a `workspace:*` in the ROOT package does not
 * resolve on the bun version the deploy image runs. The build fails before a
 * line of this file is read.
 *
 * Drift is caught end to end rather than by a shared symbol: the api verifies
 * with the real `verifyWebhookSignature`, so a scheme change makes the injected
 * delivery 401 and the run fails loudly with "the api refused the delivery".
 */
function signDelivery(body: string, secret: string): string {
	return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

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
		const [scheme, host] = this.config.gitOrigin.split("://");
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
		body?: JsonValue,
	): Promise<unknown> {
		// A statement, not a conditional spread: a content-type on a bodyless GET
		// is a lie, and the spread buries that choice in the literal.
		const headers = new Headers({
			authorization: `Bearer ${this.config.token}`,
			accept: "application/json",
		});
		if (body !== undefined) {
			headers.set("content-type", "application/json");
		}
		const res = await fetch(`${this.config.origin}${path}`, {
			method,
			headers,
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		const text = await res.text();
		if (!res.ok) {
			throw new Error(`${method} ${path} failed: ${res.status} ${text}`);
		}
		return text.length === 0 ? null : JSON.parse(text);
	}

	/** True when the remote has no refs at all — a freshly created repo. */
	async isEmpty(): Promise<boolean> {
		const refs = await $`git ls-remote ${this.pushUrl}`.nothrow().text();
		return refs.trim() === "";
	}

	/**
	 * Give an empty repo its first commit on the base branch. A repo with no refs
	 * has no branch to open a pull request against, so there is nothing to test
	 * until this runs. Only ever called when `isEmpty()` is true, so it cannot
	 * overwrite anyone's history.
	 */
	async initialise(): Promise<void> {
		await $`rm -rf ${this.config.workdir}`.quiet();
		await $`mkdir -p ${this.config.workdir}`.quiet();
		await this.git("init");
		await this.git("checkout", "-b", this.config.base);
		await Bun.write(
			join(this.config.workdir, "README.md"),
			"# playground\n\nSacrificial repo for the tripwire open-git e2e harness.\n",
		);
		await this.git("add", "README.md");
		await this.git("commit", "-m", "chore: initialise playground");
		await this.git("push", this.pushUrl, this.config.base);
	}

	/** Clone once, reuse across runs — same shape as the github driver. */
	async prepare(): Promise<void> {
		const exists = await Bun.file(
			join(this.config.workdir, ".git", "HEAD"),
		).exists();
		if (!exists) {
			await $`git clone ${this.pushUrl} ${this.config.workdir}`.quiet();
		}
		// Fetch by URL, not by remote name. `initialise()` builds the workdir with
		// `git init`, which has no `origin`, and a clone's `origin` would carry the
		// credentials in .git/config anyway.
		await this.git("fetch", this.pushUrl, this.config.base);
		await this.git("checkout", "-B", this.config.base, "FETCH_HEAD");
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

	/** Another commit on an existing branch — a `synchronize`, a new head sha. */
	async pushCommit(input: {
		branch: string;
		edits: FileEdit;
		message: string;
	}): Promise<string> {
		await this.git("checkout", input.branch);
		for (const [path, content] of Object.entries(input.edits)) {
			await Bun.write(join(this.config.workdir, path), content ?? "");
			await this.git("add", path);
		}
		await this.git("commit", "-m", input.message);
		await this.git("push", this.pushUrl, input.branch);
		return (await $`git rev-parse HEAD`.cwd(this.config.workdir).text()).trim();
	}

	/**
	 * Find-or-create, because this driver never closes anything: a second run of
	 * the same scenario meets its own pull request from the first run still open.
	 * Matched on TITLE — open-git's list response carries no source branch, and
	 * the title is what identifies a scenario anyway.
	 */
	async openPr(input: {
		branch: string;
		title: string;
		body: string;
	}): Promise<{ number: number; url: string; reused: boolean }> {
		const listed = (await this.api(
			"GET",
			`/api/v1/repos/${this.config.repo}/pulls?state=open`,
		)) as { pulls?: { number: number; title: string }[] };
		const existing = listed.pulls?.find((pull) => pull.title === input.title);
		const number =
			existing?.number ??
			(
				(await this.api("POST", `/api/v1/repos/${this.config.repo}/pulls`, {
					title: input.title,
					body: input.body,
					sourceBranch: input.branch,
					targetBranch: this.config.base,
				})) as { number: number }
			).number;
		const pr = {
			number,
			url: `${this.config.origin}/${this.config.repo}/pulls/${number}`,
			reused: existing !== undefined,
		};
		if (!this.openedPrs.some((open) => open.number === number)) {
			this.openedPrs.push(pr);
		}
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

	/**
	 * Post the delivery open-git WOULD have sent, signed with the same secret,
	 * straight at a local api. This exists because a quick tunnel gets a new
	 * hostname on every restart, so the bot's webhook url goes stale constantly
	 * and a run dies waiting for a delivery that was posted into the void.
	 *
	 * It skips exactly one hop — open-git's outbound POST. Everything after it is
	 * the real path: real signature verification, real normalization, real
	 * engine, and a real check written back to open-git over its api. The payload
	 * shape is open-git's own, from docs/integrations/webhooks.md.
	 */
	async injectDelivery(input: {
		apiUrl: string;
		secret: string;
		event: string;
		installationId: string;
		repoExternalId: string;
		number: number;
		author: string;
		title: string;
		body: string;
		headSha: string;
	}): Promise<{ status: number; text: string }> {
		const [owner, name] = this.config.repo.split("/");
		const payload = JSON.stringify({
			action: input.event.slice(input.event.lastIndexOf(".") + 1),
			installation_id: input.installationId,
			pull_request: {
				id: `${input.number}`,
				number: input.number,
				author: input.author,
				title: input.title,
				body: input.body,
				head_sha: input.headSha,
			},
			repository: { id: input.repoExternalId, name, owner },
		});
		const res = await fetch(`${input.apiUrl}/webhooks/opengit`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				// The delivery id is the IDEMPOTENCY key, so it must differ per
				// delivery. Keyed on the sha alone, a re-title on the same commit
				// looked like a replay and was correctly discarded — which proved
				// dedupe works, and made the edit event untestable.
				"x-open-git-delivery": `injected-${input.event}-${input.headSha.slice(0, 12)}`,
				"x-open-git-event": input.event,
				"x-hub-signature-256": signDelivery(payload, input.secret),
			},
			body: payload,
		});
		return { status: res.status, text: await res.text() };
	}

	/**
	 * Poll until the `tripwire` check reaches a SPECIFIC status. Used to prove a
	 * re-evaluation actually flipped the gate: the check upserts by name on the
	 * same commit, so "settled" is not enough — the first verdict is already
	 * settled when the second delivery arrives.
	 */
	async waitForCheckStatus(
		sha: string,
		want: string,
		onPoll?: (message: string) => void,
	): Promise<OpenGitCheck | null> {
		const deadline = Date.now() + this.config.timeoutMs;
		while (Date.now() < deadline) {
			const tripwire = (await this.listChecks(sha)).find(
				(check) => check.name === CHECK_NAME,
			);
			if (tripwire?.status === want) {
				return tripwire;
			}
			onPoll?.(`check is ${tripwire?.status ?? "absent"}, waiting for ${want}`);
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
/** `https://open-git.com` → `https://git.open-git.com`. */
function defaultGitOrigin(origin: string): string {
	const [scheme, host] = origin.split("://");
	return `${scheme}://git.${host}`;
}

export function loadOpenGitConfig(
	base: HarnessConfig,
	env: NodeJS.ProcessEnv = process.env,
): OpenGitConfig | null {
	const origin = (env.OPEN_GIT_URL ?? "https://open-git.com").replace(
		/\/$/,
		"",
	);
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
		origin,
		// open-git serves git from its own host. Derived from the web origin
		// unless told otherwise, so a self-hosted instance can point elsewhere.
		gitOrigin: (env.OPEN_GIT_GIT_URL ?? defaultGitOrigin(origin)).replace(
			/\/$/,
			"",
		),
		workdir: env.OPEN_GIT_TEST_WORKDIR ?? `${base.workdir}-opengit`,
		timeoutMs: base.timeoutMs,
		pollMs: base.pollMs,
	};
}
