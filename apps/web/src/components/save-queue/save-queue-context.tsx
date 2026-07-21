import { useBlocker } from "@tanstack/react-router";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";

/**
 * The batched save queue: pending changes collect here instead of hitting the
 * server per control, and the unsaved-changes bar commits or discards them as
 * one action. Generic on purpose — persistence is INJECTED by the consumer
 * (see [[unsaved-changes-bar]]); this file knows no page, no server function,
 * no schema. A page adopts the unit by wrapping in the provider, supplying
 * `savedValues` + `commit`, and binding its controls through
 * `useSaveQueueField`. While the provider is mounted, no control on the page
 * may write directly — a control that keeps its own mutation splits the
 * source of truth. NOTE: the navigation guard rides on UnsavedChangesBar, not
 * this provider — mount the bar or you have no leave-protection while dirty.
 */

/**
 * A commit's outcome. An N-write consumer (one batch fanning into several
 * server calls) can report a PARTIAL failure via `failedKeys`: those keys stay
 * queued, everything else clears. Bare `{ error }` keeps the whole queue; bare
 * `{ ok }` clears it. `failedKeys` is plain key strings — no page concept
 * enters the unit.
 */
export type SaveQueueCommitResult =
	| { ok: true }
	| { error: string; failedKeys?: string[] };

export type SaveQueueCommit = (
	pending: Record<string, unknown>,
) => Promise<SaveQueueCommitResult>;

interface SaveQueueValue {
	pending: Record<string, unknown>;
	isDirty: boolean;
	count: number;
	isCommitting: boolean;
	/** Pending-or-saved for a key — what a control renders. */
	valueFor: (key: string) => unknown;
	/** Queue a change. A value equal to the saved one CLEARS the key (no
	 * queued noop); a later change to the same key replaces the earlier. */
	setField: (key: string, value: unknown) => void;
	commit: () => Promise<void>;
	discard: () => void;
}

const SaveQueueContext = createContext<SaveQueueValue | null>(null);

/**
 * The queue transition, pure: equal-to-saved clears the key, anything else
 * replaces it. Extracted so the noop-clearing law is unit-testable without a
 * DOM.
 */
export function nextPending(
	prev: Record<string, unknown>,
	savedValues: Record<string, unknown>,
	key: string,
	value: unknown,
	isEqual: (a: unknown, b: unknown) => boolean,
): Record<string, unknown> {
	if (isEqual(value, savedValues[key])) {
		if (!(key in prev)) {
			return prev;
		}
		const { [key]: _cleared, ...rest } = prev;
		return rest;
	}
	return { ...prev, [key]: value };
}

/**
 * The queue after a commit resolves, pure: success clears, bare failure keeps
 * everything, partial failure keeps ONLY the failed keys — the bar's count
 * stays honest about what actually persisted.
 */
export function pendingAfterCommit(
	pending: Record<string, unknown>,
	result: SaveQueueCommitResult,
): Record<string, unknown> {
	if ("ok" in result) {
		return {};
	}
	if (!result.failedKeys) {
		return pending;
	}
	const kept: Record<string, unknown> = {};
	for (const key of result.failedKeys) {
		if (key in pending) {
			kept[key] = pending[key];
		}
	}
	return kept;
}

export interface SaveQueueProviderProps {
	/** Last-saved values per key — the noop-clearing baseline and the
	 * fallback `valueFor` reads through to. */
	savedValues: Record<string, unknown>;
	/** One batch, one persisted action, one success signal. The consumer owns
	 * invalidation and the toast; on failure it must NOT invalidate, so the
	 * pending overlay keeps the user's edits on screen. */
	commit: SaveQueueCommit;
	/** Per-key equality for noop-clearing. Object.is suits primitive values;
	 * a page with object-valued keys passes its own (e.g. JSON equality). */
	isEqual?: (a: unknown, b: unknown) => boolean;
	children: ReactNode;
}

export function SaveQueueProvider({
	savedValues,
	commit: commitFn,
	isEqual = Object.is,
	children,
}: SaveQueueProviderProps) {
	const [pending, setPending] = useState<Record<string, unknown>>({});
	const [isCommitting, setIsCommitting] = useState(false);
	const count = Object.keys(pending).length;
	const isDirty = count > 0;

	const setField = useCallback(
		(key: string, value: unknown) => {
			setPending((prev) => nextPending(prev, savedValues, key, value, isEqual));
		},
		[isEqual, savedValues],
	);

	const valueFor = useCallback(
		(key: string) => (key in pending ? pending[key] : savedValues[key]),
		[pending, savedValues],
	);

	const commit = useCallback(async () => {
		if (!isDirty || isCommitting) {
			return;
		}
		setIsCommitting(true);
		try {
			const result = await commitFn(pending);
			// Success clears; bare failure preserves the whole queue; partial
			// failure keeps only the failed keys (see pendingAfterCommit).
			setPending((prev) => pendingAfterCommit(prev, result));
		} catch {
			// Network-level throw: keep the queue.
		} finally {
			setIsCommitting(false);
		}
	}, [commitFn, isCommitting, isDirty, pending]);

	const discard = useCallback(() => setPending({}), []);

	const value = useMemo<SaveQueueValue>(
		() => ({
			pending,
			isDirty,
			count,
			isCommitting,
			valueFor,
			setField,
			commit,
			discard,
		}),
		[
			pending,
			isDirty,
			count,
			isCommitting,
			valueFor,
			setField,
			commit,
			discard,
		],
	);

	return (
		<SaveQueueContext.Provider value={value}>
			{children}
		</SaveQueueContext.Provider>
	);
}

export function useSaveQueue(): SaveQueueValue {
	const context = useContext(SaveQueueContext);
	if (!context) {
		throw new Error("useSaveQueue requires a SaveQueueProvider");
	}
	return context;
}

/**
 * Navigation-away protection while dirty: in-app navigations confirm, hard
 * reloads/closes get the browser prompt. Rendered by the unsaved-changes bar
 * (every adopting page mounts it), NOT by the provider — the provider stays
 * router-free so components under it render in router-less tests. Native
 * confirm for now; upgradeable to the Dialog primitive without an API change.
 */
export function SaveQueueNavGuard() {
	const { isDirty } = useSaveQueue();
	useBlocker({
		disabled: !isDirty,
		shouldBlockFn: () =>
			!window.confirm("you have unsaved changes. leave anyway?"),
		enableBeforeUnload: () => isDirty,
	});
	return null;
}

/** The uniform control binding: read pending-or-saved, write to the queue. */
export function useSaveQueueField<T>(
	key: string,
): readonly [T, (next: T) => void] {
	const { valueFor, setField } = useSaveQueue();
	const set = useCallback((next: T) => setField(key, next), [key, setField]);
	return [valueFor(key) as T, set] as const;
}
