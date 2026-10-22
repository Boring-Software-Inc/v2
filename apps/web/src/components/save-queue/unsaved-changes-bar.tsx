import { Button } from "#/components/glaze/ui/button";
import {
	DiscardChangesButton,
	SaveQueueNavGuard,
	useSaveQueue,
} from "#/components/save-queue/save-queue-context";

/**
 * The floating unsaved-changes bar. Driven ONLY by provider state — it has no
 * idea what is being saved. Hidden when clean. Centered pill above the mobile
 * footer nav and the responses drawer tab.
 */
export function UnsavedChangesBar() {
	const { isDirty, count, isCommitting, commit, discard } = useSaveQueue();
	return (
		<>
			<SaveQueueNavGuard />
			{isDirty ? (
				<div className="pointer-events-none fixed inset-x-0 bottom-22 z-(--z-overlay) flex justify-center px-4 md:bottom-6">
					<section
						aria-label="Unsaved changes"
						className="overlay pointer-events-auto flex items-center gap-2 rounded-pill py-1 ps-4 pe-1"
					>
						<span className="type-label-sm">
							{count} unsaved {count === 1 ? "change" : "changes"}
						</span>
						<DiscardChangesButton disabled={isCommitting} onDiscard={discard} />
						<Button
							onClick={commit}
							pending={isCommitting}
							pendingLabel="Saving"
							size="sm"
						>
							Save changes
						</Button>
					</section>
				</div>
			) : null}
		</>
	);
}
