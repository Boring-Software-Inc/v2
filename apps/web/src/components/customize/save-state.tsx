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

export function SaveState({ canEdit, error, onDiscard }: SaveStateProps) {
	const { isDirty, count, isCommitting, commit } = useSaveQueue();
	const saving = useShownAfter(isCommitting, WAIT_SHOW_MS);

	let status = (
		<Status size="sm" status="ok">
			Saved
		</Status>
	);
	if (!canEdit) {
		status = (
			<span className="type-caption text-text-2">
				Only org admins can change this
			</span>
		);
	} else if (error && !isCommitting) {
		status = (
			<span className="flex flex-col items-end gap-0.5">
				<Status size="sm" status="fail">
					Not saved
				</Status>
				<span className="type-caption text-fail-text">{error}</span>
			</span>
		);
	} else if (isDirty) {
		status = (
			<span className="type-caption text-text-2 tabular-nums">
				{count} unsaved {count === 1 ? "change" : "changes"}
			</span>
		);
	}

	return (
		<div className="flex min-h-(--control-sm) items-center justify-end gap-2">
			<SaveQueueNavGuard />
			<output>{status}</output>
			{canEdit && isDirty ? (
				<>
					<DiscardChangesButton disabled={isCommitting} onDiscard={onDiscard} />
					<Button
						onClick={commit}
						pending={saving}
						pendingLabel="Saving"
						size="sm"
					>
						{error ? "Save again" : "Save changes"}
					</Button>
				</>
			) : null}
		</div>
	);
}
