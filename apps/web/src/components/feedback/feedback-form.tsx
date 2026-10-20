import { useCallback, useId, useRef, useState } from "react";
import { Icon, Pointer } from "#/components/glaze/icon";
import { Button } from "#/components/glaze/ui/button";
import {
	DialogAction,
	DialogBody,
	DialogClose,
	DialogFooter,
} from "#/components/glaze/ui/dialog";
import {
	Field,
	FieldContent,
	FieldError,
	FieldLabel,
} from "#/components/glaze/ui/field";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "#/components/glaze/ui/item";
import { Status } from "#/components/glaze/ui/status";
import { Switch } from "#/components/glaze/ui/switch";
import { Textarea } from "#/components/glaze/ui/textarea";
import { submitFeedback } from "#/lib/feedback.functions";
import { captureViewport } from "./capture";
import { toFeedbackElement, useFeedback } from "./feedback-context";

type SendStatus = "idle" | "sending" | "success" | "error";

function blobToDataUrl(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onloadend = () => resolve(reader.result as string);
		reader.onerror = () => reject(new Error("failed to read screenshot"));
		reader.readAsDataURL(blob);
	});
}

export function FeedbackForm({ onSuccess }: { onSuccess?: () => void }) {
	const {
		close,
		elementContext,
		screenshotBlob: preCapture,
		startSelection,
		config,
	} = useFeedback();
	const [status, setStatus] = useState<SendStatus>("idle");
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [comment, setComment] = useState("");
	const [prompt, setPrompt] = useState("");
	const [includeScreenshot, setIncludeScreenshot] = useState(true);
	/** Set only by a submit attempt — the field never reads invalid while typing. */
	const [commentInvalid, setCommentInvalid] = useState(false);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const formId = useId();

	const ui = {
		placeholder:
			config.ui?.placeholder ?? "What happened? What did you expect?",
		submitLabel: config.ui?.submitLabel ?? "Send feedback",
		cancelLabel: config.ui?.cancelLabel ?? "Cancel",
	};

	const handleClose = useCallback(() => {
		if (status === "sending") {
			return;
		}
		setStatus("idle");
		setErrorMessage(null);
		setComment("");
		setPrompt("");
		setIncludeScreenshot(true);
		close();
	}, [status, close]);

	const handleSubmit = useCallback(async () => {
		// Submit stays enabled so the requirement is discoverable — validate here
		// and send focus to the field that has to change.
		if (!comment.trim()) {
			setCommentInvalid(true);
			textareaRef.current?.focus();
			return;
		}
		setCommentInvalid(false);
		setStatus("sending");
		try {
			let screenshotDataUrl: string | null = null;
			if (includeScreenshot) {
				const blob = preCapture ?? (await captureViewport());
				if (blob) {
					screenshotDataUrl = await blobToDataUrl(blob);
				}
			}

			const result = await submitFeedback({
				data: {
					comment: comment.trim(),
					route: window.location.pathname,
					userAgent: navigator.userAgent,
					prompt: prompt.trim() || undefined,
					element: elementContext ? toFeedbackElement(elementContext) : null,
					metadata: config.metadata,
					screenshotDataUrl,
				},
			});
			if (!result.ok) {
				throw new Error("Failed to submit feedback");
			}
			setStatus("success");
			setErrorMessage(null);
			setTimeout(() => {
				onSuccess?.();
				handleClose();
			}, 1500);
		} catch (err) {
			setStatus("error");
			setErrorMessage(
				err instanceof Error
					? err.message
					: "Something went wrong. Please try again.",
			);
		}
	}, [
		comment,
		prompt,
		includeScreenshot,
		preCapture,
		config.metadata,
		elementContext,
		handleClose,
		onSuccess,
	]);

	const sourceFrame = elementContext?.stack[0] ?? null;
	const sourceLabel = sourceFrame?.fileName
		? `${sourceFrame.fileName.split("/").pop()}${sourceFrame.lineNumber ? `:${sourceFrame.lineNumber}` : ""}`
		: null;

	if (status === "success") {
		return (
			<DialogBody>
				<output className="flex flex-col items-center gap-1 py-6 text-center">
					<Status status="ok">Feedback sent</Status>
					<span className="type-body-sm text-text-2">
						Thanks for helping us improve.
					</span>
				</output>
			</DialogBody>
		);
	}

	const sending = status === "sending";

	return (
		<>
			<DialogBody>
				<form
					className="flex flex-col gap-4"
					id={formId}
					noValidate
					onSubmit={(e) => {
						e.preventDefault();
						void handleSubmit();
					}}
				>
					{elementContext ? (
						<ItemGroup aria-label="Selected component">
							<Item>
								<ItemMedia variant="icon">
									<Icon icon={Pointer} />
								</ItemMedia>
								<ItemContent>
									<ItemTitle>
										{elementContext.componentName || "Unknown"}
									</ItemTitle>
									{sourceLabel ? (
										<ItemDescription className="mono">
											{sourceLabel}
										</ItemDescription>
									) : null}
								</ItemContent>
								<ItemActions>
									<Button
										onClick={startSelection}
										size="sm"
										type="button"
										variant="secondary"
									>
										Reselect
									</Button>
								</ItemActions>
							</Item>
						</ItemGroup>
					) : (
						<div className="flex flex-col items-start gap-1">
							<Button
								onClick={startSelection}
								size="sm"
								type="button"
								variant="secondary"
							>
								<Icon icon={Pointer} />
								Point at a component
							</Button>
							<span className="type-caption text-text-2">
								Attach its source and a screenshot.
							</span>
						</div>
					)}

					<Field invalid={commentInvalid}>
						<FieldLabel>What happened</FieldLabel>
						<Textarea
							disabled={sending}
							onValueChange={(value) => {
								setComment(value);
								if (commentInvalid) setCommentInvalid(false);
							}}
							placeholder={ui.placeholder}
							ref={textareaRef}
							rows={3}
							value={comment}
						/>
						{commentInvalid ? (
							<FieldError>
								Describe what happened so we can act on it.
							</FieldError>
						) : null}
					</Field>

					<Field>
						<FieldLabel optional>Suggested fix</FieldLabel>
						<Textarea
							disabled={sending}
							onValueChange={setPrompt}
							placeholder="What would you have expected instead?"
							rows={2}
							value={prompt}
						/>
					</Field>

					<Field orientation="horizontal">
						<FieldContent>
							<FieldLabel>Attach screenshot</FieldLabel>
						</FieldContent>
						<Switch
							checked={includeScreenshot}
							onCheckedChange={setIncludeScreenshot}
						/>
					</Field>

					{status === "error" && errorMessage ? (
						<p className="type-body-sm text-fail-text" role="alert">
							{errorMessage}
						</p>
					) : null}
				</form>
			</DialogBody>
			<DialogFooter defaultAction="none">
				<DialogClose disabled={sending} onClick={handleClose}>
					{ui.cancelLabel}
				</DialogClose>
				<DialogAction
					close={false}
					form={formId}
					pending={sending}
					type="submit"
				>
					{ui.submitLabel}
				</DialogAction>
			</DialogFooter>
		</>
	);
}
