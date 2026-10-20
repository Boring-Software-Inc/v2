import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "#/components/glaze/ui/dialog";
import { useFeedback } from "./feedback-context";
import { FeedbackForm } from "./feedback-form";

export function FeedbackDialog() {
	const { isOpen, close, config } = useFeedback();

	return (
		<Dialog
			onOpenChange={(open) => {
				if (!open) {
					close();
				}
			}}
			open={isOpen}
		>
			<DialogContent data-feedback-ignore data-screenshot-ignore>
				<DialogHeader>
					<DialogTitle>{config.ui?.title ?? "Send feedback"}</DialogTitle>
					<DialogDescription>
						{config.ui?.description ??
							"Tell us what's off or what could be better."}
					</DialogDescription>
				</DialogHeader>
				<FeedbackForm />
			</DialogContent>
		</Dialog>
	);
}
