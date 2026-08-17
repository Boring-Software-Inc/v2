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
import type { WorkerReads } from "./context.ts";

/**
 * Normalization is PURE (no credentials), so it is chosen per forge separately
 * from the cred-gated runtime — an event still normalizes and persists even when
 * that forge's reads/actions are offline.
 */
export function normalizeFor(
	_forge: Forge,
): (event: RawForgeEvent, receivedAt: string) => NormalizedEvent | null {
	// One live forge today; the parameter is the seam every adapter plugs into.
	return normalizeGithub;
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
}): (forge: Forge) => ForgeRuntime {
	return () => ({
		adapter: runtime.adapter ?? null,
		reads: runtime.reads ?? null,
		signalHttp: runtime.signalHttp ?? null,
	});
}

type MeterHook = (bytes: { bytesIn: number; bytesOut: number }) => void;

export interface ResolveForgeInput {
	db: Db;
	/** Metering hook folded into every forge call (reads, actions, producers). */
	onCall: MeterHook;
	/** GitHub App credentials, or null when the App env is absent. */
	github: { appId: string; privateKey: string } | null;
}

/**
 * Build the resolver ONCE at boot. GitHub needs App credentials (null ⇒ no
 * GitHub runtime).
 */
export function buildResolveForge(
	input: ResolveForgeInput,
): (forge: Forge) => ForgeRuntime | null {
	const github = input.github
		? buildGithubRuntime(input.db, input.github, input.onCall)
		: null;
	return (forge: Forge): ForgeRuntime | null =>
		forge === "github" ? github : null;
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
	};
}
