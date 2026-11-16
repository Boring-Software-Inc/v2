export type PopupPlacement = "top" | "right" | "bottom" | "left";
export type PopupAlign = "start" | "center" | "end";
export type PopupOffset = "tight" | "compact" | "standard" | "spacious";

const POPUP_OFFSET_VALUE = {
	tight: 4,
	compact: 6,
	standard: 8,
	spacious: 12,
} satisfies Record<PopupOffset, number>;

export function popupOffsetValue(offset: PopupOffset): number {
	return POPUP_OFFSET_VALUE[offset];
}
