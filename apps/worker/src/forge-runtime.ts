import type { Forge, NormalizedEvent } from "@tripwire/contracts";
import type { Db } from "@tripwire/db";
import { repoServices } from "@tripwire/db";
import type { ForgeAdapter, RawForgeEvent } from "@tripwire/forge";
import {
	createGithubAdapter,
	GithubHttp,
	GithubReads,
	InstallationTokenCache,
	normalizeWebhook as normalizeGithub,
} from "@tripwire/forge-github";
import {
	createOpenGitAdapter,
	listInstallationRepos,
	normalizeWebhook as normalizeOpenGit,
	type OpenGitBotCredentials,
	OpenGitTokenCache,
} from "@tripwire/forge-opengit";
import type { WorkerReads } from "./context.ts";

/**
 * Normalization is PURE (no credentials), so it is chosen per forge separately
 * from the cred-gated runtime — an event still normalizes and persists even when
 * that forge's reads/actions are offline.
 */
const NORMALIZERS = {
	github: normalizeGithub,
	opengit: normalizeOpenGit,
} satisfies Record<
	Forge,
	(event: RawForgeEvent, receivedAt: string) => NormalizedEvent | null
>;

export function normalizeFor(
	forge: Forge,
): (event: RawForgeEvent, receivedAt: string) => NormalizedEvent | null {
	return NORMALIZERS[forge];
}

/**
 * Per-forge runtime selection (§4). The worker holds ONE resolver; every event
 * picks its runtime by `event.forge`, so every forge's events each get
 * the right adapter, read surface, and token flow. This is the seam that keeps
 * `processEvent` forge-agnostic — it never names a forge, it names the event's.
 */
export interface ForgeRuntime {
	/** null ⇒ actions record but do not execute (no credentials). */
	adapter: ForgeAdapter | null;
	/** null ⇒ rules skip on missing context (§6). */
	reads: WorkerReads | null;
	/**
	 * GitHub-only signal HTTP for custom-rule producers. null on forges that do
	 * not (yet) expose it — custom rules skip, they never guess.
	 */
	signalHttp: GithubHttp | null;
	/**
	 * Resolve which repositories an installation grants, by installation id.
	 *
	 * null on forges whose installation WEBHOOK already names them — GitHub
	 * sends full repo objects, so it needs no lookup. open-git sends bare uuids,
	 * so the delivery alone cannot build a repo row and the worker must ask.
	 *
	 * Authenticated app-wide, not per repo: at this point there is no repo to
	 * mint an installation token against. Discovering them IS the job.
	 */
	installationRepos:
		| ((installationId: string) => Promise<{
				repos: {
					externalId: string;
					owner: string;
					name: string;
					fullName: string;
				}[];
				active: boolean;
		  }>)
		| null;
}

/**
 * A resolver that always returns the same runtime pieces, ignoring the forge —
 * the injection seam for tests (and any single-forge caller). Missing pieces
 * default to null, matching the fail-closed degrade.
 */
export function staticForge(runtime: {
	adapter?: ForgeAdapter | null;
	reads?: WorkerReads | null;
	signalHttp?: GithubHttp | null;
	installationRepos?: ForgeRuntime["installationRepos"];
}): (forge: Forge) => ForgeRuntime {
	return () => ({
		adapter: runtime.adapter ?? null,
		reads: runtime.reads ?? null,
		signalHttp: runtime.signalHttp ?? null,
		installationRepos: runtime.installationRepos ?? null,
	});
}

type MeterHook = (bytes: { bytesIn: number; bytesOut: number }) => void;

export interface ResolveForgeInput {
	db: Db;
	/** Metering hook folded into every forge call (reads, actions, producers). */
	onCall: MeterHook;
	/** GitHub App credentials, or null when the App env is absent. */
	github: { appId: string; privateKey: string } | null;
	/** open-git bot credentials, or null when the bot env is absent. */
	opengit: (OpenGitBotCredentials & { apiBase?: string }) | null;
}

/**
 * Build the resolver ONCE at boot. Each forge needs its own credentials; absent
 * credentials ⇒ no runtime for that forge, and its events still normalize and
 * persist (normalization is pure and chosen separately, above).
 */
export function buildResolveForge(
	input: ResolveForgeInput,
): (forge: Forge) => ForgeRuntime | null {
	const runtimes = {
		github: input.github
			? buildGithubRuntime(input.db, input.github, input.onCall)
			: null,
		opengit: input.opengit
			? buildOpenGitRuntime(input.db, input.opengit, input.onCall)
			: null,
	} satisfies Record<Forge, ForgeRuntime | null>;
	return (forge: Forge): ForgeRuntime | null => runtimes[forge];
}

/**
 * open-git resolves with an adapter but NO reads, which is the shape §4
 * anticipated: actions are real (the `tripwire` check is its whole merge gate)
 * while its v1 API exposes no diff, commits, contents or users. `reads: null`
 * makes every read-dependent rule skip on missing context (§6) instead of
 * evaluating against invented data.
 *
 * `signalHttp` is null too — the custom-rule signal producers are GitHub's, and
 * a custom rule on open-git skips rather than guessing.
 */
function buildOpenGitRuntime(
	db: Db,
	credentials: OpenGitBotCredentials & { apiBase?: string },
	onCall: MeterHook,
): ForgeRuntime {
	const tokens = new OpenGitTokenCache(credentials, credentials.apiBase);
	const tokenFor = async (repoFullName: string): Promise<string> => {
		const repo = await repoServices.getRepoByFullName(
			db,
			repoFullName,
			"opengit",
		);
		if (!repo?.installationId) {
			throw new Error(`no installation for ${repoFullName}`);
		}
		return await tokens.getToken(repo.installationId);
	};
	return {
		adapter: createOpenGitAdapter({
			tokenFor,
			onCall,
			apiBase: credentials.apiBase,
		}),
		reads: null,
		signalHttp: null,
		installationRepos: (installationId) =>
			listInstallationRepos(credentials, installationId, credentials.apiBase),
	};
}

function buildGithubRuntime(
	db: Db,
	credentials: { appId: string; privateKey: string },
	onCall: MeterHook,
): ForgeRuntime {
	const tokens = new InstallationTokenCache(credentials);
	const tokenFor = async (repoFullName: string): Promise<string> => {
		const repo = await repoServices.getRepoByFullName(
			db,
			repoFullName,
			"github",
		);
		if (!repo?.installationId) {
			throw new Error(`no installation for ${repoFullName}`);
		}
		return await tokens.getToken(repo.installationId);
	};
	const httpOptions = { tokenFor, onCall };
	return {
		adapter: createGithubAdapter(httpOptions),
		reads: new GithubReads(httpOptions),
		signalHttp: new GithubHttp(httpOptions),
		// GitHub's installation webhook already names every repository.
		installationRepos: null,
	};
}
