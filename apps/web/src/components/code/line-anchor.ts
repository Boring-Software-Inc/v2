export interface LineRange {
	start: number;
	end: number;
}

const ANCHOR = /^#L(\d+)(?:-L(\d+))?$/;

export function parseLineAnchor(hash: string): LineRange | null {
	const match = ANCHOR.exec(hash);
	if (!match) {
		return null;
	}
	const first = Number(match[1]);
	const second = match[2] === undefined ? first : Number(match[2]);
	if (first < 1 || second < 1) {
		return null;
	}
	return { start: Math.min(first, second), end: Math.max(first, second) };
}

export function formatLineAnchor(range: LineRange | null): string {
	if (!range) {
		return "";
	}
	const start = Math.min(range.start, range.end);
	const end = Math.max(range.start, range.end);
	return start === end ? `#L${start}` : `#L${start}-L${end}`;
}
