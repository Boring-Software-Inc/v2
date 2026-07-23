import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-run resource counters (economics-surface-contracts.md). The GitHub client
 * and the OpenRouter transport are shared across runs, so we scope their counts
 * with an AsyncLocalStorage store established per run. The transport callbacks
 * read the CURRENT store, attributing bytes to whichever run is executing.
 * Metering only observes: a missing store is a silent no-op.
 */
export interface RunCounter {
	githubApiCalls: number;
	githubBytesIn: number;
	githubBytesOut: number;
	openrouterBytesOut: number;
}

const store = new AsyncLocalStorage<RunCounter>();

/** Run `fn` inside a fresh counter scope. All transport counts nest under it. */
export function runWithCounter<T>(fn: () => Promise<T>): Promise<T> {
	return store.run(
		{
			githubApiCalls: 0,
			githubBytesIn: 0,
			githubBytesOut: 0,
			openrouterBytesOut: 0,
		},
		fn,
	);
}

/** Fold one GitHub request into the active run counter, if any. */
export function addGithubCall(m: { bytesIn: number; bytesOut: number }): void {
	const c = store.getStore();
	if (!c) {
		return;
	}
	c.githubApiCalls += 1;
	c.githubBytesIn += m.bytesIn;
	c.githubBytesOut += m.bytesOut;
}

/** Fold OpenRouter request bytes into the active run counter, if any. */
export function addOpenRouterBytesOut(bytes: number): void {
	const c = store.getStore();
	if (c) {
		c.openrouterBytesOut += bytes;
	}
}

/** The active run counter, or undefined outside a run scope. */
export function getCounter(): RunCounter | undefined {
	return store.getStore();
}
