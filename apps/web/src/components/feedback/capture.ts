const MASK_SELECTOR = '[data-privacy="masked"]';

interface CaptureHighlight {
	rect: DOMRect;
	label: string;
}

/**
 * Viewport screenshot via @renoun/screenshot (lazy — stays out of the entry
 * chunk). The overlay layer and feedback dialog carry `data-screenshot-ignore`
 * so the shot shows the page, not our chrome. Privacy-masked elements are
 * blurred in the live DOM for the duration of the render, then restored.
 * A failure returns null — feedback still submits without the shot.
 */
export async function captureViewport(
	highlight?: CaptureHighlight,
): Promise<Blob | null> {
	const { screenshot } = await import("@renoun/screenshot");
	const cleanups: Array<() => void> = [];
	try {
		for (const el of document.querySelectorAll<HTMLElement>(MASK_SELECTOR)) {
			const previous = el.style.filter;
			el.style.filter = "blur(10px)";
			cleanups.push(() => {
				el.style.filter = previous;
			});
		}
		if (highlight) {
			cleanups.push(appendHighlight(highlight));
		}
		return await screenshot.blob(document.body, {
			x: window.scrollX,
			y: window.scrollY,
			width: window.innerWidth,
			height: window.innerHeight,
			includeFixed: "intersecting",
			format: "png",
		});
	} catch (error) {
		console.error("[feedback] screenshot capture failed:", error);
		return null;
	} finally {
		for (const cleanup of cleanups.reverse()) {
			cleanup();
		}
	}
}

function appendHighlight({ rect, label }: CaptureHighlight): () => void {
	const box = document.createElement("div");
	box.className =
		"pointer-events-none fixed top-(--pick-top) left-(--pick-left) z-(--z-overlay) h-(--pick-height) w-(--pick-width) rounded-tag border border-ink bg-hover";
	box.style.setProperty("--pick-top", `${rect.top}px`);
	box.style.setProperty("--pick-left", `${rect.left}px`);
	box.style.setProperty("--pick-width", `${rect.width}px`);
	box.style.setProperty("--pick-height", `${rect.height}px`);
	const tag = document.createElement("div");
	tag.className =
		"absolute bottom-full start-0 mb-1 whitespace-nowrap rounded-tag bg-ink px-1.5 py-0.5 type-code-xs text-text-inverse";
	tag.textContent = label;
	box.append(tag);
	document.body.append(box);
	return () => {
		box.remove();
	};
}
