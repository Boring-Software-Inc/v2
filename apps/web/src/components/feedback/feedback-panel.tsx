import { Badge } from "@tripwire/ui/badge";
import { Button } from "@tripwire/ui/button";
import { Textarea } from "@tripwire/ui/field";
import { Close, Icon } from "@tripwire/ui/icon";
import { type CSSProperties, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { submitFeedback } from "#/lib/feedback.functions";
import { cn } from "#/lib/utils";
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
	const { picked, draft, setDraft, pickAgain, close, finish, session, config } =
		useFeedback();
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
			setError("Write your feedback.");
			textareaRef.current?.focus();
			return;
		}
		const sentFrom = session;
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
			notify.show({ title: "Feedback sent" }, "success");
			finish(sentFrom);
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
					"shell grid-rows-[minmax(0,1fr)] tone-border-default tone-content-primary outline-none forced-colors:outline-solid forced-colors:outline-1 forced-colors:outline-[CanvasText]",
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
					className="panel"
					data-layout-role="feedback-form"
					id={`${titleId}-form`}
					noValidate
					onSubmit={(e) => {
						e.preventDefault();
						void send();
					}}
				>
					<div className="flex items-center justify-between composition-gap-standard">
						<h2 data-layout-role="feedback-title" id={titleId}>
							Send feedback
						</h2>
						<Button
							ariaLabel="Close"
							disabled={sending}
							onAction={close}
							size="small"
							type="button"
							variant="ghost"
						>
							<Icon icon={Close} />
						</Button>
					</div>
					<div className="flex min-w-0 items-center justify-between composition-gap-standard">
						{picked ? (
							<Badge className="min-w-0" title={picked.summary.path}>
								<span className="mono truncate">{picked.name}</span>
							</Badge>
						) : null}
						<div
							data-layout-role="feedback-pick-action"
							data-picked={picked ? "" : undefined}
						>
							<Button
								disabled={sending}
								onAction={pickAgain}
								size="small"
								type="button"
								variant="ghost"
							>
								{picked ? "Pick again" : "Pick an element"}
							</Button>
						</div>
					</div>
					<Textarea
						ariaDescribedBy={error ? errorId : undefined}
						ariaLabel="Feedback"
						invalid={error ? true : undefined}
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
							className="content-body-small tone-danger"
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
						size="small"
						type="submit"
					>
						Send
					</Button>
				</div>
			</div>
		</>
	);
}

import { notify } from "@tripwire/ui/toast";
