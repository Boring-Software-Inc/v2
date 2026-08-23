/**
 * Interrupt cleanup registry. A running scenario registers its teardown here so
 * a Ctrl-C restores the pinned config instead of leaving it pinned on the
 * sacrificial repo. The scenario clears it on a normal exit. Kept tiny and
 * module-global on purpose: only one scenario runs at a time.
 *
 * A Ctrl-C does NOT close the PR it opened. An open PR on a sacrificial repo is
 * recoverable; a closed one may not be inspectable at all — open-git has no
 * closed-PR surface — and the evidence is the point of the run. The teardown is
 * told it was interrupted so it can keep the artifacts and print where they are.
 */
export interface TeardownOptions {
	/** True when a Ctrl-C triggered this teardown, not a normal exit. */
	interrupted: boolean;
}

type Teardown = (options: TeardownOptions) => Promise<void>;

let activeCleanup: Teardown | null = null;

export function setActiveCleanup(fn: Teardown | null): void {
	activeCleanup = fn;
}

/** Run the active scenario's teardown, if one is registered. */
export async function runActiveCleanup(
	options: TeardownOptions = { interrupted: true },
): Promise<void> {
	if (activeCleanup) {
		await activeCleanup(options);
	}
}
