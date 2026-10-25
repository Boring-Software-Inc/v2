import { type CSSProperties, useEffect, useState } from "react";
import type { Box } from "./placement";

const TAG_ROOM = 24;

function boxOf(element: Element): Box {
	const rect = element.getBoundingClientRect();
	return {
		left: rect.left,
		top: rect.top,
		width: rect.width,
		height: rect.height,
	};
}

function sameBox(a: Box | null, b: Box | null): boolean {
	return (
		a === b ||
		(a !== null &&
			b !== null &&
			a.left === b.left &&
			a.top === b.top &&
			a.width === b.width &&
			a.height === b.height)
	);
}

export function useViewportBox(element: Element | null): Box | null {
	const [box, setBox] = useState<Box | null>(null);

	useEffect(() => {
		if (!element) {
			setBox(null);
			return;
		}
		let frame = 0;
		const measure = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => {
				const next = element.isConnected ? boxOf(element) : null;
				setBox((prev) => (sameBox(prev, next) ? prev : next));
			});
		};
		measure();
		const resize = new ResizeObserver(measure);
		resize.observe(element);
		window.addEventListener("scroll", measure, true);
		window.addEventListener("resize", measure);
		return () => {
			cancelAnimationFrame(frame);
			resize.disconnect();
			window.removeEventListener("scroll", measure, true);
			window.removeEventListener("resize", measure);
		};
	}, [element]);

	return box;
}

function radiusOf(element: Element): string {
	const radius = Number.parseFloat(
		getComputedStyle(element).borderTopLeftRadius,
	);
	return Number.isFinite(radius) && radius > 0 ? `${radius}px` : "0px";
}

export function PickOutline({
	element,
	box,
	name,
}: {
	element: Element;
	box: Box;
	name: string | null;
}) {
	const tagBelow = box.top < TAG_ROOM;
	return (
		<div
			aria-hidden
			className="pointer-events-none fixed top-(--pick-top) left-(--pick-left) z-(--z-overlay) h-(--pick-height) w-(--pick-width) rounded-(--pick-radius) focus-ring"
			data-feedback-chrome
			data-screenshot-ignore
			style={
				{
					"--pick-top": `${box.top}px`,
					"--pick-left": `${box.left}px`,
					"--pick-width": `${box.width}px`,
					"--pick-height": `${box.height}px`,
					"--pick-radius": radiusOf(element),
				} as CSSProperties
			}
		>
			{name ? (
				<span
					className={
						tagBelow
							? "absolute start-0 top-full mt-2 whitespace-nowrap rounded-tag bg-ink px-1.5 py-0.5 type-code-xs text-text-inverse"
							: "absolute start-0 bottom-full mb-2 whitespace-nowrap rounded-tag bg-ink px-1.5 py-0.5 type-code-xs text-text-inverse"
					}
				>
					{name}
				</span>
			) : null}
		</div>
	);
}
