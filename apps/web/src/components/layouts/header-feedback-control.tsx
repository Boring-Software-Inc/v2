import { useFeedback } from "#/components/feedback";
import { Button } from "#/design-system/ui/button";

/** The dashboard header's quiet entry point into element feedback. */
export function HeaderFeedbackControl() {
	const { start } = useFeedback();
	return (
		<Button
			aria-label="Tripwire is in beta. Send feedback"
			className="min-w-0 shrink gap-0 px-2"
			data-feedback-name="HeaderFeedbackControl"
			onClick={start}
			size="sm"
			variant="ghost"
		>
			Beta
		</Button>
	);
}
