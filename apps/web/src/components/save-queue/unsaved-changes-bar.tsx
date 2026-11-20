import { Button } from "@tripwire/ui/button";
import {
	DiscardChangesButton,
	SaveQueueNavGuard,
	useSaveQueue,
} from "#/components/save-queue/save-queue-context";

const LOCAL_APPEARANCE = {
	node24_1: "overlay flex items-center gap-2 rounded-pill py-1 ps-4 pe-1",
	node27_2: "type-label-sm",
	node57_3:
		"pointer-events-none fixed inset-x-0 bottom-22 z-(--z-overlay) flex justify-center px-4 md:bottom-6 [&_[data-layout-role=unsaved-changes-toolbar]]:pointer-events-auto",
} as const;

export interface UnsavedChangesToolbarProps {
	error?: string | null;
	onDiscard?: () => void;
}

export function UnsavedChangesToolbar({
	error,
	onDiscard,
}: UnsavedChangesToolbarProps) {
	const { isDirty, count, isCommitting, commit, discard } = useSaveQueue();
	return (
		<>
			<SaveQueueNavGuard />
			{isDirty ? (
				<section
					aria-label="Unsaved changes"
					className={LOCAL_APPEARANCE.node24_1}
					data-layout-role="unsaved-changes-toolbar"
				>
					<span className={LOCAL_APPEARANCE.node27_2}>
						{error
							? "Not saved"
							: `${count} unsaved ${count === 1 ? "change" : "changes"}`}
					</span>
					<DiscardChangesButton
						disabled={isCommitting}
						onDiscard={onDiscard ?? discard}
					/>
					<Button
						onAction={commit}
						pending={isCommitting}
						pendingLabel="Saving"
						size="small"
					>
						{error ? "Save again" : "Save changes"}
					</Button>
				</section>
			) : null}
		</>
	);
}

/**
 * The floating unsaved-changes bar. Driven ONLY by provider state — it has no
 * idea what is being saved. Hidden when clean. Centered pill above the mobile
 * footer nav and the responses drawer tab.
 */
export function UnsavedChangesBar() {
	return (
		<div className={LOCAL_APPEARANCE.node57_3}>
			<UnsavedChangesToolbar />
		</div>
	);
}
