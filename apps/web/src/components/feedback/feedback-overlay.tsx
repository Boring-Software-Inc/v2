import { getDisplayName, getFiberFromHostInstance, traverseFiber } from "bippy";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { freeze, getElementContext, unfreeze } from "react-grab/primitives";
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

const ACCENT = "#34a6ff";

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

async function captureScreenshot(
	target: Element,
	componentName: string | null,
): Promise<Blob | null> {
	const overlayEl = document.getElementById("feedback-overlay-layer");
	if (overlayEl) {
		overlayEl.style.display = "none";
	}
	try {
		const selectedRect = target.getBoundingClientRect();
		const highlightLabel = componentName ?? target.tagName.toLowerCase();
		const html2canvas = (await import("html2canvas-pro")).default;
		const canvas = await html2canvas(document.body, {
			logging: false,
			width: window.innerWidth,
			height: window.innerHeight,
			scrollX: -window.scrollX,
			scrollY: -window.scrollY,
			windowWidth: window.innerWidth,
			windowHeight: window.innerHeight,
			onclone: (clonedDoc) => {
				for (const el of clonedDoc.querySelectorAll<HTMLElement>(
					'[data-privacy="masked"]',
				)) {
					el.style.filter = "blur(10px)";
				}
				const highlight = clonedDoc.createElement("div");
				Object.assign(highlight.style, {
					position: "fixed",
					top: `${selectedRect.top}px`,
					left: `${selectedRect.left}px`,
					width: `${selectedRect.width}px`,
					height: `${selectedRect.height}px`,
					border: `2px solid ${ACCENT}`,
					backgroundColor: "rgba(52, 166, 255, 0.08)",
					borderRadius: "3px",
					zIndex: "999999",
					pointerEvents: "none",
				});
				clonedDoc.body.appendChild(highlight);
				const label = clonedDoc.createElement("div");
				Object.assign(label.style, {
					position: "fixed",
					top: `${Math.max(selectedRect.top - 24, 4)}px`,
					left: `${selectedRect.left}px`,
					backgroundColor: ACCENT,
					color: "#ffffff",
					fontSize: "11px",
					fontFamily: "ui-monospace, monospace",
					fontWeight: "500",
					padding: "2px 6px",
					borderRadius: "3px",
					zIndex: "999999",
					pointerEvents: "none",
					whiteSpace: "nowrap",
				});
				label.textContent = highlightLabel;
				clonedDoc.body.appendChild(label);
			},
		});
		return await new Promise<Blob | null>((resolve) =>
			canvas.toBlob((b) => resolve(b), "image/png"),
		);
	} catch {
		return null;
	} finally {
		if (overlayEl) {
			overlayEl.style.display = "";
		}
	}
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
				captureScreenshot(target, componentName).then((blob) => {
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
			className="fixed inset-0 z-[9998] cursor-crosshair bg-black/10"
			data-feedback-ignore
			id="feedback-overlay-layer"
		>
			<div className="-translate-x-1/2 absolute top-4 left-1/2 rounded-full border bg-popover px-4 py-2 font-medium text-foreground text-sm shadow-lg">
				{isResolving
					? "Resolving component…"
					: "Click an element to select it · Esc to cancel"}
			</div>

			{hovered ? (
				<div
					className="pointer-events-none fixed rounded-sm border-2 transition-all duration-75 ease-out"
					ref={highlightRef}
					style={{
						top: hovered.rect.top,
						left: hovered.rect.left,
						width: hovered.rect.width,
						height: hovered.rect.height,
						borderColor: ACCENT,
						backgroundColor: "rgba(52, 166, 255, 0.1)",
					}}
				>
					<div
						className="absolute -top-6 left-0 flex items-center gap-1 whitespace-nowrap rounded-sm px-2 py-0.5 text-white text-xs"
						style={{ backgroundColor: ACCENT }}
					>
						{hovered.componentName ? (
							<>
								<span className="font-medium">{hovered.componentName}</span>
								<span className="font-mono opacity-60">{hovered.tagName}</span>
							</>
						) : (
							<span className="font-mono">{hovered.tagName}</span>
						)}
					</div>
				</div>
			) : null}
		</div>,
		document.body,
	);
}
