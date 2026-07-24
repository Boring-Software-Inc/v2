import { CursorInWindowIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useRef, useState } from "react";
import { Button } from "#/components/ui/button";
import { Dither } from "#/components/ui/dither";
import { submitFeedback } from "#/lib/feedback.functions";
import { cn } from "#/lib/utils";
import { captureViewport } from "./capture";
import { toFeedbackElement, useFeedback } from "./feedback-context";

type Status = "idle" | "sending" | "success" | "error";

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
	const [status, setStatus] = useState<Status>("idle");
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [comment, setComment] = useState("");
	const [prompt, setPrompt] = useState("");
	const [includeScreenshot, setIncludeScreenshot] = useState(true);
	const textareaRef = useRef<HTMLTextAreaElement>(null);

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
		if (!comment.trim()) {
			return;
		}
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
			<div className="flex flex-col items-center gap-2 py-8 text-center">
				<div className="flex size-10 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500">
					✓
				</div>
				<p className="font-medium text-foreground text-sm">Feedback sent</p>
				<p className="text-muted-foreground text-xs">
					Thanks for helping us improve.
				</p>
			</div>
		);
	}

	return (
		<form
			className="flex flex-col gap-3"
			onSubmit={(e) => {
				e.preventDefault();
				void handleSubmit();
			}}
		>
			{elementContext ? (
				<div className="flex items-center gap-2 rounded-md border bg-surface-1 px-2.5 py-2 text-xs">
					<HugeiconsIcon
						className="shrink-0 text-emerald-500"
						icon={CursorInWindowIcon}
						size={14}
						strokeWidth={2}
					/>
					<span className="truncate font-medium text-foreground">
						{elementContext.componentName || "Unknown"}
					</span>
					{sourceLabel ? (
						<span className="truncate font-mono text-muted-foreground">
							{sourceLabel}
						</span>
					) : null}
					<button
						className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
						onClick={startSelection}
						type="button"
					>
						reselect
					</button>
				</div>
			) : (
				<button
					className="group relative flex items-center gap-2.5 overflow-hidden rounded-lg border border-dashed px-3 py-2 text-left transition-colors hover:border-solid"
					onClick={startSelection}
					type="button"
				>
					<Dither
						className="opacity-70 transition-opacity duration-300 group-hover:opacity-100"
						speed={0.5}
					/>
					<HugeiconsIcon
						className="relative shrink-0 text-foreground"
						icon={CursorInWindowIcon}
						size={17}
						strokeWidth={2}
					/>
					<span className="relative flex min-w-0 flex-1 flex-col">
						<span className="font-medium text-foreground text-sm">
							Point at a component
						</span>
						<span className="text-muted-foreground text-xs">
							attach its source + a screenshot
						</span>
					</span>
					<span className="relative shrink-0 text-muted-foreground text-sm transition-colors group-hover:text-foreground">
						→
					</span>
				</button>
			)}

			<textarea
				className="w-full resize-none rounded-lg border bg-background px-3 py-2.5 text-foreground text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-ring disabled:opacity-50"
				disabled={status === "sending"}
				onChange={(e) => setComment(e.target.value)}
				placeholder={ui.placeholder}
				ref={textareaRef}
				required
				rows={3}
				value={comment}
			/>

			<textarea
				className="w-full resize-none rounded-lg border bg-background px-3 py-2.5 text-foreground text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-ring disabled:opacity-50"
				disabled={status === "sending"}
				onChange={(e) => setPrompt(e.target.value)}
				placeholder="Suggested fix (optional)"
				rows={2}
				value={prompt}
			/>

			<div className="flex items-center justify-between pt-1">
				<label className="group flex cursor-pointer select-none items-center gap-2">
					<button
						aria-checked={includeScreenshot}
						className={cn(
							"relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
							includeScreenshot ? "bg-foreground" : "bg-border",
						)}
						onClick={() => setIncludeScreenshot((v) => !v)}
						role="switch"
						type="button"
					>
						<span
							className={cn(
								"inline-block size-3.5 rounded-full bg-background transition-transform",
								includeScreenshot ? "translate-x-[18px]" : "translate-x-[3px]",
							)}
						/>
					</button>
					<span className="text-muted-foreground text-xs transition-colors group-hover:text-foreground">
						Screenshot
					</span>
				</label>

				<div className="flex items-center gap-2">
					<Button
						disabled={status === "sending"}
						onClick={handleClose}
						size="sm"
						type="button"
						variant="ghost"
					>
						{ui.cancelLabel}
					</Button>
					<Button
						disabled={status === "sending" || !comment.trim()}
						size="sm"
						type="submit"
					>
						{status === "sending" ? "sending…" : ui.submitLabel}
					</Button>
				</div>
			</div>

			{status === "error" && errorMessage ? (
				<p className="text-red-500 text-xs">{errorMessage}</p>
			) : null}
		</form>
	);
}
