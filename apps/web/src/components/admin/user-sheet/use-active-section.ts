import { type RefObject, useEffect, useState } from "react";
import {
	activeSectionAt,
	SHEET_SECTIONS,
	type SheetSectionId,
} from "#/lib/admin-user-sheet";

export function useActiveSection(
	container: RefObject<HTMLElement | null>,
	ready: boolean,
): SheetSectionId {
	const [active, setActive] = useState<SheetSectionId>("access");
	useEffect(() => {
		const root = container.current;
		if (!(root && ready)) {
			return;
		}
		let frame = 0;
		const measure = () => {
			frame = 0;
			const nav = root.querySelector("nav");
			const line = (nav?.getBoundingClientRect().bottom ?? 0) + 72;
			const tops = SHEET_SECTIONS.map((section) => ({
				id: section.id,
				top:
					root
						.querySelector(`[data-section="${section.id}"]`)
						?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY,
			}));
			setActive(activeSectionAt(tops, line));
		};
		const onScroll = () => {
			if (frame === 0) {
				frame = requestAnimationFrame(measure);
			}
		};
		measure();
		root.addEventListener("scroll", onScroll, { capture: true, passive: true });
		window.addEventListener("resize", onScroll);
		return () => {
			root.removeEventListener("scroll", onScroll, { capture: true });
			window.removeEventListener("resize", onScroll);
			if (frame !== 0) {
				cancelAnimationFrame(frame);
			}
		};
	}, [container, ready]);
	return active;
}
