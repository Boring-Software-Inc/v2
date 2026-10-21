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
}: {
	canEdit: boolean;
	error: string | null;
	isDirty: boolean;
	isCommitting: boolean;
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
			<span className="flex flex-col items-end gap-0.5 text-end">
				<Status size="sm" status="fail">
					Not saved
				</Status>
				<span className="type-caption text-fail-text">{error}</span>
			</span>
		);
	}
	if (isDirty) {
		return (
			<span className="type-body-sm text-text-2 max-lg:sr-only">
				Unsaved changes
			</span>
		);
	}
	return (
		<Status size="sm" status="ok">
			Saved
		</Status>
	);
}

export function SaveState({ canEdit, error, onDiscard }: SaveStateProps) {
	const { isDirty, isCommitting, commit } = useSaveQueue();
	const saving = useShownAfter(isCommitting, WAIT_SHOW_MS);
	return (
		<div className="flex min-h-(--control-sm) flex-wrap items-center justify-end gap-x-2 gap-y-1">
			<SaveQueueNavGuard />
			<output>
				<SaveStatus
					canEdit={canEdit}
					error={error}
					isCommitting={isCommitting}
					isDirty={isDirty}
				/>
			</output>
			{canEdit && isDirty ? (
				<>
					<DiscardChangesButton
						touch
						disabled={isCommitting}
						onDiscard={onDiscard}
					/>
					<Button
						data-touch=""
						onClick={commit}
						pending={saving}
						pendingLabel="Saving"
						size="sm"
					>
						{error ? "Save again" : "Save"}
					</Button>
				</>
			) : null}
		</div>
	);
}
