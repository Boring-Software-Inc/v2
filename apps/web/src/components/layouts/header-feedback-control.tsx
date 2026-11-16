import { Button } from "@tripwire/ui/button";
import { useFeedback } from "#/components/feedback";

/** The dashboard header's quiet entry point into element feedback. */
export function HeaderFeedbackControl() {
	const { start } = useFeedback();
	return (
		<span
			className="min-w-0 shrink gap-0 px-2"
			data-feedback-name="HeaderFeedbackControl"
		>
			<Button
				ariaLabel="Tripwire is in beta. Send feedback"
				onAction={start}
				size="small"
				variant="ghost"
			>
				Beta
			</Button>
		</span>
	);
}
