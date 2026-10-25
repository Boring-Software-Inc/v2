export const PANEL_GAP = 16;
export const VIEWPORT_MARGIN = 8;

export type PanelSide = "right" | "left" | "below" | "above" | "pinned";

export interface Box {
	left: number;
	top: number;
	width: number;
	height: number;
}

export interface Size {
	width: number;
	height: number;
}

export interface Placement {
	side: PanelSide;
	left: number;
	top: number;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), Math.max(min, max));
}

export function placePanel(
	target: Box | null,
	panel: Size,
	viewport: Size,
	gap = PANEL_GAP,
	margin = VIEWPORT_MARGIN,
): Placement {
	const maxLeft = viewport.width - margin - panel.width;
	const maxTop = viewport.height - margin - panel.height;
	const pinned: Placement = {
		side: "pinned",
		left: clamp(maxLeft, margin, maxLeft),
		top: clamp(maxTop, margin, maxTop),
	};
	if (!target) {
		return pinned;
	}
	const right = target.left + target.width;
	const bottom = target.top + target.height;
	const offScreen =
		bottom <= 0 ||
		target.top >= viewport.height ||
		right <= 0 ||
		target.left >= viewport.width;
	if (offScreen) {
		return pinned;
	}
	const sideTop = clamp(target.top, margin, maxTop);
	const stackLeft = clamp(target.left, margin, maxLeft);

	if (right + gap + panel.width <= viewport.width - margin) {
		return { side: "right", left: right + gap, top: sideTop };
	}
	if (target.left - gap - panel.width >= margin) {
		return {
			side: "left",
			left: target.left - gap - panel.width,
			top: sideTop,
		};
	}
	if (
		bottom + gap >= margin &&
		bottom + gap + panel.height <= viewport.height - margin
	) {
		return { side: "below", left: stackLeft, top: bottom + gap };
	}
	if (
		target.top - gap - panel.height >= margin &&
		target.top - gap <= viewport.height - margin
	) {
		return {
			side: "above",
			left: stackLeft,
			top: target.top - gap - panel.height,
		};
	}
	return pinned;
}
