const MASK_SELECTOR = '[data-privacy="masked"]';

async function withMasking(shoot: () => Promise<Blob>): Promise<Blob | null> {
	const cleanups: Array<() => void> = [];
	try {
		for (const el of document.querySelectorAll<HTMLElement>(MASK_SELECTOR)) {
			const previous = el.style.filter;
			el.style.filter = "blur(10px)";
			cleanups.push(() => {
				el.style.filter = previous;
			});
		}
		return await shoot();
	} catch (error) {
		console.error("[feedback] screenshot capture failed:", error);
		return null;
	} finally {
		for (const cleanup of cleanups.reverse()) {
			cleanup();
		}
	}
}

export function captureViewport(): Promise<Blob | null> {
	return withMasking(async () => {
		const { screenshot } = await import("@renoun/screenshot");
		return screenshot.blob(document.body, {
			x: window.scrollX,
			y: window.scrollY,
			width: window.innerWidth,
			height: window.innerHeight,
			includeFixed: "intersecting",
			format: "png",
		});
	});
}

export function captureElement(element: Element): Promise<Blob | null> {
	return withMasking(async () => {
		const { screenshot } = await import("@renoun/screenshot");
		return screenshot.blob(element, { format: "png" });
	});
}
