import { AnimatePresence, motion } from "motion/react";
import {
	SaveQueueNavGuard,
	useSaveQueue,
} from "#/components/save-queue/save-queue-context";
import { Button } from "#/components/ui/button";

const SPRING = { type: "spring", stiffness: 420, damping: 38 } as const;

/**
 * The floating unsaved-changes bar. Driven ONLY by provider state — it has no
 * idea what is being saved. Hidden when clean. Centered pill above the mobile
 * footer nav and the customize drawer tab (z-50 clears the sheet's z-20).
 */
export function UnsavedChangesBar() {
	const { isDirty, count, isCommitting, commit, discard } = useSaveQueue();
	return (
		<>
			<SaveQueueNavGuard />
			<AnimatePresence>
				{isDirty ? (
					<motion.div
						animate={{ opacity: 1, y: 0 }}
						className="pointer-events-none fixed inset-x-0 bottom-[5.5rem] z-50 flex justify-center md:bottom-6"
						exit={{ opacity: 0, y: 12 }}
						initial={{ opacity: 0, y: 12 }}
						transition={SPRING}
					>
						<div className="pointer-events-auto flex items-center gap-2 rounded-full border bg-popover py-1.5 pr-1.5 pl-4 shadow-lg">
							<span className="text-xs">
								You have {count} unsaved change{count === 1 ? "" : "s"}
							</span>
							<Button
								disabled={isCommitting}
								onClick={discard}
								size="xs"
								variant="ghost"
							>
								discard
							</Button>
							<Button disabled={isCommitting} onClick={commit} size="xs">
								save changes
							</Button>
						</div>
					</motion.div>
				) : null}
			</AnimatePresence>
		</>
	);
}
