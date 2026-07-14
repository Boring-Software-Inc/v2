import {
	Cancel01Icon,
	CursorMagicSelection02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect } from "react";
import { useFeedback } from "./feedback-context";
import { FeedbackForm } from "./feedback-form";

/**
 * The feedback modal — v2's overlay pattern (button backdrop + role=dialog
 * sibling, Esc closes), matching the command palette. Holds the form and the
 * "inspect an element" entry into selection mode ([[feedback-overlay]]).
 */
export function FeedbackDialog() {
	const { isOpen, close, startSelection, elementContext, config } =
		useFeedback();

	useEffect(() => {
		if (!isOpen) {
			return;
		}
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				close();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [isOpen, close]);

	if (!isOpen) {
		return null;
	}

	return (
		<div className="fixed inset-0 z-50" data-feedback-ignore>
			<button
				aria-label="close feedback"
				className="absolute inset-0 bg-background/60"
				onClick={close}
				type="button"
			/>
			<div
				aria-modal="true"
				className="-translate-x-1/2 absolute top-[14vh] left-1/2 w-full max-w-md px-4"
				role="dialog"
			>
				<div className="overflow-hidden rounded-xl border bg-popover shadow-lg">
					<div className="flex items-start justify-between gap-3 border-b px-5 pt-4 pb-3">
						<div className="flex flex-col gap-0.5">
							<h2 className="font-semibold text-base leading-none">
								{config.ui?.title ?? "Send feedback"}
							</h2>
							<p className="text-muted-foreground text-xs">
								{config.ui?.description ??
									"Tell us what's off or what could be better."}
							</p>
						</div>
						<div className="flex shrink-0 items-center gap-1">
							<button
								className="flex h-7 items-center gap-1.5 rounded-md px-2 text-muted-foreground text-xs transition-colors hover:bg-surface-1 hover:text-foreground"
								onClick={startSelection}
								title="Point at a component to attach it"
								type="button"
							>
								<HugeiconsIcon
									icon={CursorMagicSelection02Icon}
									size={14}
									strokeWidth={2}
								/>
								{elementContext ? "reselect" : "inspect"}
							</button>
							<button
								aria-label="Close"
								className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-1 hover:text-foreground"
								onClick={close}
								type="button"
							>
								<HugeiconsIcon icon={Cancel01Icon} size={16} strokeWidth={2} />
							</button>
						</div>
					</div>
					<div className="px-5 py-4">
						<FeedbackForm />
					</div>
				</div>
			</div>
		</div>
	);
}
