import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "#/components/glaze/ui/button";
import { Kbd } from "#/components/glaze/ui/kbd";
import { useFeedback } from "./feedback-context";
import { PickOutline, useViewportBox } from "./feedback-outline";
import {
	CANDIDATE_SELECTOR,
	FEEDBACK_CHROME_ATTR,
	type PickTarget,
	resolvePick,
	summarize,
	visibleTextOf,
} from "./pick";

const BLOCKED_EVENTS = [
	"pointerdown",
	"pointerup",
	"mousedown",
	"mouseup",
	"click",
	"dblclick",
	"contextmenu",
] as const;

const PICKING_CLASS = "feedback-picking";

function inChrome(node: EventTarget | null): boolean {
	return (
		node instanceof Element &&
		node.closest(`[${FEEDBACK_CHROME_ATTR}]`) !== null
	);
}

function pageElementAt(x: number, y: number): HTMLElement | null {
	for (const el of document.elementsFromPoint(x, y)) {
		if (!inChrome(el) && el instanceof HTMLElement) {
			return el;
		}
	}
	return null;
}

function candidates(): HTMLElement[] {
	return Array.from(
		document.querySelectorAll<HTMLElement>(CANDIDATE_SELECTOR),
	).filter((el) => {
		if (inChrome(el)) {
			return false;
		}
		const rect = el.getBoundingClientRect();
		return rect.width > 0 && rect.height > 0 && el.checkVisibility();
	});
}

export function FeedbackPicker() {
	const { phase } = useFeedback();
	if (phase !== "picking") {
		return null;
	}
	return createPortal(<Picker />, document.body);
}

function Picker() {
	const { pick, cancelPicking } = useFeedback();
	const [hovered, setHovered] = useState<PickTarget<HTMLElement> | null>(null);
	const [announcement, setAnnouncement] = useState("");
	const barRef = useRef<HTMLDivElement>(null);
	const skipRef = useRef<HTMLButtonElement>(null);
	const hoveredRef = useRef(hovered);
	hoveredRef.current = hovered;
	const indexRef = useRef(-1);
	const box = useViewportBox(hovered?.node ?? null);

	const latest = useRef({ pick, cancelPicking });
	latest.current = { pick, cancelPicking };

	useEffect(() => {
		const root = document.documentElement;
		root.classList.add(PICKING_CLASS);
		barRef.current?.focus({ preventScroll: true });

		let pointer: { x: number; y: number } | null = null;

		const choose = (target: PickTarget<HTMLElement> | null) => {
			if (!target) {
				return;
			}
			latest.current.pick({
				element: target.node,
				name: target.name,
				summary: summarize(target, visibleTextOf(target.node)),
			});
		};

		const hoverAt = (x: number, y: number) => {
			setHovered(resolvePick(pageElementAt(x, y)));
		};

		const onPointerMove = (e: PointerEvent) => {
			if (e.pointerType === "touch") {
				return;
			}
			pointer = { x: e.clientX, y: e.clientY };
			indexRef.current = -1;
			hoverAt(e.clientX, e.clientY);
		};

		const onScroll = () => {
			if (pointer && indexRef.current === -1) {
				hoverAt(pointer.x, pointer.y);
			}
		};

		const block = (e: Event) => {
			if (inChrome(e.target)) {
				return;
			}
			e.preventDefault();
			e.stopPropagation();
			if (e.type === "click" && e instanceof MouseEvent) {
				choose(resolvePick(pageElementAt(e.clientX, e.clientY)));
			}
		};

		const step = (backward: boolean) => {
			const list = candidates();
			const stops = list.length + 1;
			const current = indexRef.current;
			const next =
				current === -1
					? backward
						? stops - 1
						: 0
					: (current + (backward ? -1 : 1) + stops) % stops;
			indexRef.current = next;
			const el = list[next];
			if (!el) {
				setHovered(null);
				setAnnouncement("");
				skipRef.current?.focus({ preventScroll: true });
				return;
			}
			const target = resolvePick(el);
			setHovered(target);
			setAnnouncement(
				target ? `${target.name}, ${next + 1} of ${list.length}` : "",
			);
			barRef.current?.focus({ preventScroll: true });
			el.scrollIntoView({ block: "nearest", inline: "nearest" });
		};

		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				latest.current.cancelPicking();
				return;
			}
			if (e.key === "Tab") {
				e.preventDefault();
				e.stopPropagation();
				step(e.shiftKey);
				return;
			}
			if (document.activeElement === skipRef.current) {
				return;
			}
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				e.stopPropagation();
				choose(hoveredRef.current);
			}
		};

		window.addEventListener("pointermove", onPointerMove, true);
		window.addEventListener("scroll", onScroll, true);
		window.addEventListener("keydown", onKeyDown, true);
		for (const type of BLOCKED_EVENTS) {
			window.addEventListener(type, block, true);
		}
		return () => {
			root.classList.remove(PICKING_CLASS);
			window.removeEventListener("pointermove", onPointerMove, true);
			window.removeEventListener("scroll", onScroll, true);
			window.removeEventListener("keydown", onKeyDown, true);
			for (const type of BLOCKED_EVENTS) {
				window.removeEventListener(type, block, true);
			}
		};
	}, []);

	return (
		<>
			{hovered && box ? (
				<PickOutline box={box} element={hovered.node} name={hovered.name} />
			) : null}
			<div
				aria-label="Pick what this is about"
				className="fixed bottom-6 left-1/2 z-(--z-overlay) flex w-max max-w-[calc(100vw-var(--space-4)*2)] -translate-x-1/2 items-center gap-2 rounded-pill border border-line bg-paper py-1 ps-4 pe-1 text-text-1 outline-none focus-visible:focus-ring"
				data-feedback-chrome
				data-screenshot-ignore
				ref={barRef}
				role="dialog"
				tabIndex={-1}
			>
				<span className="type-label">Pick what this is about</span>
				<span aria-live="polite" className="sr-only">
					{announcement}
				</span>
				<Button
					onClick={() => latest.current.pick(null)}
					ref={skipRef}
					size="sm"
					variant="ghost"
				>
					Skip
				</Button>
				<Kbd className="me-1.5">Esc</Kbd>
			</div>
		</>
	);
}
