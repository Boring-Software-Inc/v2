import { type CSSProperties, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Close, Icon } from "#/components/glaze/icon";
import { Badge } from "#/components/glaze/ui/badge";
import { Button } from "#/components/glaze/ui/button";
import { Textarea } from "#/components/glaze/ui/textarea";
import { toast } from "#/components/glaze/ui/toast";
import { submitFeedback } from "#/lib/feedback.functions";
import { overlayPanel, overlayShell } from "#/lib/glaze/overlay";
import { cn } from "#/lib/glaze/utils";
import { captureElement, captureViewport } from "./capture";
import { useFeedback } from "./feedback-context";
import { PickOutline, useViewportBox } from "./feedback-outline";
import { placePanel, type Size } from "./placement";

const SEND_ERROR =
	"Couldn't send your feedback. Check your connection and try again.";

function blobToDataUrl(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onloadend = () => resolve(reader.result as string);
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(blob);
	});
}

async function screenshotOf(element: Element | null): Promise<string | null> {
	const blob =
		element?.isConnected === true
			? await captureElement(element)
			: await captureViewport();
	if (!blob) {
		return null;
	}
	try {
		return await blobToDataUrl(blob);
	} catch {
		return null;
	}
}

export function FeedbackPanel() {
	const { phase } = useFeedback();
	if (phase !== "open") {
		return null;
	}
	return createPortal(<Panel />, document.body);
}

function usePanelSize(panel: HTMLElement | null): Size | null {
	const [size, setSize] = useState<Size | null>(null);
	useEffect(() => {
		if (!panel) {
			return;
		}
		const observer = new ResizeObserver(() => {
			setSize({ width: panel.offsetWidth, height: panel.offsetHeight });
		});
		observer.observe(panel);
		return () => observer.disconnect();
	}, [panel]);
	return size;
}

function readViewport(): Size {
	return {
		width: document.documentElement.clientWidth,
		height: window.innerHeight,
	};
}

function useViewport(): Size {
	const [viewport, setViewport] = useState<Size>(readViewport);
	useEffect(() => {
		const onResize = () => setViewport(readViewport());
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, []);
	return viewport;
}

function Panel() {
	const { picked, draft, setDraft, pickAgain, close, config } = useFeedback();
	const [panel, setPanel] = useState<HTMLDivElement | null>(null);
	const [sending, setSending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const titleId = useId();
	const errorId = useId();

	const element = picked?.element ?? null;
	const box = useViewportBox(element);
	const size = usePanelSize(panel);
	const viewport = useViewport();
	const placement = size
		? placePanel(element ? box : null, size, viewport)
		: null;

	const placed = placement !== null;
	useEffect(() => {
		if (placed) {
			textareaRef.current?.focus({ preventScroll: true });
		}
	}, [placed]);

	const send = async () => {
		const comment = draft.trim();
		if (!comment) {
			setError("Write what is off before you send.");
			textareaRef.current?.focus();
			return;
		}
		setError(null);
		setSending(true);
		try {
			const screenshotDataUrl = await screenshotOf(element);
			const result = await submitFeedback({
				data: {
					comment,
					route: window.location.pathname,
					userAgent: navigator.userAgent,
					element: picked?.summary ?? null,
					metadata: config.metadata,
					screenshotDataUrl,
				},
			});
			if (!result.ok) {
				throw new Error(SEND_ERROR);
			}
			toast.success("Feedback sent");
			close();
		} catch {
			setError(SEND_ERROR);
			setSending(false);
		}
	};

	return (
		<>
			{element && box ? (
				<PickOutline box={box} element={element} name={null} />
			) : null}
			<div
				aria-busy={sending || undefined}
				aria-labelledby={titleId}
				aria-modal="false"
				className={cn(
					overlayShell,
					"fixed top-(--panel-top) left-(--panel-left) z-(--z-overlay) w-[min(var(--popover),calc(100vw-var(--space-4)))]",
					placement ? "visible" : "invisible",
				)}
				data-feedback-chrome
				data-screenshot-ignore
				data-side={placement?.side}
				onKeyDown={(e) => {
					if (e.key === "Escape" && !sending) {
						e.stopPropagation();
						close();
					}
				}}
				ref={setPanel}
				role="dialog"
				style={
					{
						"--panel-top": `${placement?.top ?? 0}px`,
						"--panel-left": `${placement?.left ?? 0}px`,
					} as CSSProperties
				}
			>
				<form
					className={cn(overlayPanel, "gap-3 p-4")}
					id={`${titleId}-form`}
					noValidate
					onSubmit={(e) => {
						e.preventDefault();
						void send();
					}}
				>
					<div className="flex items-center justify-between gap-2">
						<h2 className="type-heading-sm text-text-1" id={titleId}>
							Send feedback
						</h2>
						<Button
							aria-label="Close"
							disabled={sending}
							onClick={close}
							size="icon-sm"
							type="button"
							variant="ghost"
						>
							<Icon icon={Close} />
						</Button>
					</div>
					<div className="flex min-w-0 items-center justify-between gap-2">
						{picked ? (
							<Badge className="min-w-0" title={picked.summary.path}>
								<span className="mono truncate">{picked.name}</span>
							</Badge>
						) : null}
						<Button
							className={picked ? "-me-2" : "-ms-2"}
							disabled={sending}
							onClick={pickAgain}
							size="sm"
							type="button"
							variant="ghost"
						>
							{picked ? "Pick again" : "Pick what this is about"}
						</Button>
					</div>
					<Textarea
						aria-describedby={error ? errorId : undefined}
						aria-invalid={error ? true : undefined}
						aria-labelledby={titleId}
						disabled={sending}
						onKeyDown={(e) => {
							if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
								e.preventDefault();
								void send();
							}
						}}
						onValueChange={(value) => {
							setDraft(value);
							if (error) {
								setError(null);
							}
						}}
						ref={textareaRef}
						rows={4}
						value={draft}
					/>
					{error ? (
						<p
							className="type-body-sm text-fail-text"
							id={errorId}
							role="alert"
						>
							{error}
						</p>
					) : null}
				</form>
				<div className="shell-foot justify-end">
					<Button
						form={`${titleId}-form`}
						pending={sending}
						pendingLabel="Sending"
						size="sm"
						type="submit"
					>
						Send
					</Button>
				</div>
			</div>
		</>
	);
}
