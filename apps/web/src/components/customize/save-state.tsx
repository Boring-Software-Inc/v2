import { useEffect, useState } from "react";
import { Button } from "#/components/glaze/ui/button";
import { Status } from "#/components/glaze/ui/status";
import {
	DiscardChangesButton,
	SaveQueueNavGuard,
	useSaveQueue,
} from "#/components/save-queue";

const WAIT_SHOW_MS = 150;

function useShownAfter(active: boolean, delay: number): boolean {
	const [shown, setShown] = useState(false);
	useEffect(() => {
		if (!active) {
			setShown(false);
			return;
		}
		const timer = setTimeout(() => setShown(true), delay);
		return () => clearTimeout(timer);
	}, [active, delay]);
	return active && shown;
}

export interface SaveStateProps {
	canEdit: boolean;
	error: string | null;
	onDiscard: () => void;
}

function SaveStatus({
	canEdit,
	error,
	isDirty,
	isCommitting,
	count,
	align = "end",
}: {
	canEdit: boolean;
	error: string | null;
	isDirty: boolean;
	isCommitting: boolean;
	count: number;
	align?: "start" | "end";
}) {
	if (!canEdit) {
		return (
			<span className="type-caption text-text-2">
				Only org admins can change this
			</span>
		);
	}
	if (error && !isCommitting) {
		return (
			<span
				className={
					align === "end"
						? "flex flex-col items-end gap-0.5"
						: "flex flex-col items-start gap-0.5"
				}
			>
				<Status size="sm" status="fail">
					Not saved
				</Status>
				<span className="type-caption text-fail-text">{error}</span>
			</span>
		);
	}
	if (isDirty) {
		return (
			<span className="type-caption text-text-2 tabular-nums">
				{count} unsaved {count === 1 ? "change" : "changes"}
			</span>
		);
	}
	return (
		<Status size="sm" status="ok">
			Saved
		</Status>
	);
}

function SaveActions({
	error,
	onDiscard,
}: {
	error: string | null;
	onDiscard: () => void;
}) {
	const { isCommitting, commit } = useSaveQueue();
	const saving = useShownAfter(isCommitting, WAIT_SHOW_MS);
	return (
		<>
			<DiscardChangesButton disabled={isCommitting} onDiscard={onDiscard} />
			<Button onClick={commit} pending={saving} pendingLabel="Saving" size="sm">
				{error ? "Save again" : "Save changes"}
			</Button>
		</>
	);
}

export function SaveState({ canEdit, error, onDiscard }: SaveStateProps) {
	const { isDirty, count, isCommitting } = useSaveQueue();
	return (
		<div className="flex min-h-(--control-sm) items-center justify-end gap-2">
			<SaveQueueNavGuard />
			<output>
				<SaveStatus
					canEdit={canEdit}
					count={count}
					error={error}
					isCommitting={isCommitting}
					isDirty={isDirty}
				/>
			</output>
			{canEdit && isDirty ? (
				<SaveActions error={error} onDiscard={onDiscard} />
			) : null}
		</div>
	);
}

export function MobileSaveBar({ canEdit, error, onDiscard }: SaveStateProps) {
	const { isDirty, count, isCommitting } = useSaveQueue();
	if (!(canEdit && isDirty)) {
		return null;
	}
	return (
		<section
			aria-label="Unsaved changes"
			className="sticky bottom-0 z-(--z-sticky) -mx-4 flex min-h-(--row) items-center gap-2 border-line-faint border-t bg-paper px-4 py-2 pb-[max(var(--space-2),env(safe-area-inset-bottom))] md:hidden"
		>
			<div className="me-auto min-w-0">
				<SaveStatus
					align="start"
					canEdit={canEdit}
					count={count}
					error={error}
					isCommitting={isCommitting}
					isDirty={isDirty}
				/>
			</div>
			<SaveActions error={error} onDiscard={onDiscard} />
		</section>
	);
}
