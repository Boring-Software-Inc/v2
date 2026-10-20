import { getDisplayName, getFiberFromHostInstance, traverseFiber } from "bippy";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { freeze, getElementContext, unfreeze } from "react-grab/primitives";
import { captureViewport } from "./capture";
import type { ReactGrabElementContext } from "./feedback-context";
import { useFeedback } from "./feedback-context";

/**
 * Point-and-grab element picker ([[feedback-context]]). Ported from ~/tripwire's
 * feedback overlay: hover highlights the component under the cursor (name via
 * bippy's fiber walk), click resolves its source context (react-grab) and snaps
 * a screenshot, then hands both to the form. Esc cancels.
 */

type HoveredInfo = {
	rect: DOMRect;
	componentName: string | null;
	tagName: string;
} | null;

function getComponentName(element: Element): string | null {
	const fiber = getFiberFromHostInstance(element);
	if (!fiber) {
		return null;
	}
	let name: string | null = null;
	traverseFiber(
		fiber,
		(f) => {
			const displayName = getDisplayName(f);
			if (displayName && !displayName.startsWith("_")) {
				name = displayName;
				return true;
			}
			return false;
		},
		true,
	);
	return name;
}

function captureSelection(
	target: Element,
	componentName: string | null,
): Promise<Blob | null> {
	return captureViewport({
		rect: target.getBoundingClientRect(),
		label: componentName ?? target.tagName.toLowerCase(),
	});
}

export function FeedbackOverlay() {
	const { isSelecting, selectElement, setScreenshot, cancelSelection } =
		useFeedback();
	const [hovered, setHovered] = useState<HoveredInfo>(null);
	const [isResolving, setIsResolving] = useState(false);
	const highlightRef = useRef<HTMLDivElement>(null);
	const cancelledRef = useRef(false);

	const isResolvingRef = useRef(isResolving);
	isResolvingRef.current = isResolving;
	const isSelectingRef = useRef(isSelecting);
	isSelectingRef.current = isSelecting;
	const selectElementRef = useRef(selectElement);
	selectElementRef.current = selectElement;
	const setScreenshotRef = useRef(setScreenshot);
	setScreenshotRef.current = setScreenshot;
	const cancelSelectionRef = useRef(cancelSelection);
	cancelSelectionRef.current = cancelSelection;

	// Mount-only global listeners; live values are read through refs above.
	useEffect(() => {
		const withOverlayIgnored = (
			clientX: number,
			clientY: number,
		): Element | null => {
			if (highlightRef.current) {
				highlightRef.current.style.display = "none";
			}
			const overlay = document.getElementById("feedback-overlay-layer");
			if (overlay) {
				overlay.style.pointerEvents = "none";
			}
			const target = document.elementFromPoint(clientX, clientY);
			if (overlay) {
				overlay.style.pointerEvents = "auto";
			}
			if (highlightRef.current) {
				highlightRef.current.style.display = "";
			}
			return target;
		};

		const handleMouseMove = (e: MouseEvent) => {
			if (isResolvingRef.current) {
				return;
			}
			const target = withOverlayIgnored(e.clientX, e.clientY);
			if (
				target &&
				target !== document.body &&
				!target.hasAttribute("data-feedback-ignore")
			) {
				setHovered({
					rect: target.getBoundingClientRect(),
					componentName: getComponentName(target),
					tagName: target.tagName.toLowerCase(),
				});
			} else {
				setHovered(null);
			}
		};

		const handleClick = async (e: MouseEvent) => {
			if (!isSelectingRef.current || isResolvingRef.current) {
				return;
			}
			e.preventDefault();
			e.stopPropagation();
			const target = withOverlayIgnored(e.clientX, e.clientY);
			if (!target) {
				return;
			}
			setIsResolving(true);
			cancelledRef.current = false;
			const componentName = getComponentName(target);
			try {
				freeze();
				const context = (await getElementContext(
					target,
				)) as unknown as ReactGrabElementContext;
				if (cancelledRef.current) {
					unfreeze();
					return;
				}
				unfreeze();
				selectElementRef.current(context, null);
				setIsResolving(false);
				captureSelection(target, componentName).then((blob) => {
					if (blob && !cancelledRef.current) {
						setScreenshotRef.current(blob);
					}
				});
			} catch (err) {
				unfreeze();
				setIsResolving(false);
				if (!cancelledRef.current) {
					console.error("[feedback] failed to resolve element context:", err);
					cancelSelectionRef.current();
				}
			}
		};

		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				if (isResolvingRef.current) {
					cancelledRef.current = true;
					unfreeze();
				}
				cancelSelectionRef.current();
			}
		};

		window.addEventListener("mousemove", handleMouseMove);
		window.addEventListener("click", handleClick, true);
		window.addEventListener("keydown", handleKeyDown);
		return () => {
			window.removeEventListener("mousemove", handleMouseMove);
			window.removeEventListener("click", handleClick, true);
			window.removeEventListener("keydown", handleKeyDown);
		};
	}, []);

	if (!isSelecting) {
		return null;
	}

	return createPortal(
		<div
			className="fixed inset-0 z-(--z-overlay) cursor-crosshair bg-hover"
			data-feedback-ignore
			data-screenshot-ignore
			id="feedback-overlay-layer"
		>
			<div className="-translate-x-1/2 absolute top-4 left-1/2 rounded-pill border border-line bg-paper px-3 py-1.5 type-label text-text-1">
				{isResolving
					? "Resolving component"
					: "Click an element to select it. Esc to cancel."}
			</div>

			{hovered ? (
				<div
					className="pointer-events-none fixed top-(--pick-top) left-(--pick-left) h-(--pick-height) w-(--pick-width) rounded-tag border border-ink bg-hover transition-[top,left,width,height] duration-(--dur-press) ease-out"
					ref={highlightRef}
					style={
						{
							"--pick-top": `${hovered.rect.top}px`,
							"--pick-left": `${hovered.rect.left}px`,
							"--pick-width": `${hovered.rect.width}px`,
							"--pick-height": `${hovered.rect.height}px`,
						} as CSSProperties
					}
				>
					<div className="absolute bottom-full left-0 mb-1 flex items-center gap-1 whitespace-nowrap rounded-tag bg-ink px-1.5 py-0.5 type-label-sm text-text-inverse">
						{hovered.componentName ? (
							<>
								<span>{hovered.componentName}</span>
								<span className="mono">{hovered.tagName}</span>
							</>
						) : (
							<span className="mono">{hovered.tagName}</span>
						)}
					</div>
				</div>
			) : null}
		</div>,
		document.body,
	);
}
