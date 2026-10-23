export const CODE_LENGTH = 8;

export interface CodeEdit {
	cells: string[];
	focus: number;
}

export function emptyCells(): string[] {
	return Array.from({ length: CODE_LENGTH }, () => "");
}

export function normalizeCode(raw: string): string {
	return raw.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

export function formatCode(raw: string): string {
	const code = normalizeCode(raw);
	if (code.length !== CODE_LENGTH) {
		return code;
	}
	return `${code.slice(0, CODE_LENGTH / 2)}-${code.slice(CODE_LENGTH / 2)}`;
}

export function codeHalves(raw: string): [string[], string[]] {
	const chars = [...normalizeCode(raw)];
	const middle = Math.ceil(chars.length / 2);
	return [chars.slice(0, middle), chars.slice(middle)];
}

export function isComplete(cells: string[]): boolean {
	return cells.length === CODE_LENGTH && cells.every((cell) => cell !== "");
}

export function fillFrom(
	cells: string[],
	index: number,
	raw: string,
): CodeEdit {
	const chars = [...normalizeCode(raw)];
	if (chars.length === 0) {
		return { cells, focus: index };
	}
	const start = chars.length >= CODE_LENGTH ? 0 : index;
	const next = [...cells];
	const placed = chars.slice(0, CODE_LENGTH - start);
	placed.forEach((char, offset) => {
		next[start + offset] = char;
	});
	return {
		cells: next,
		focus: Math.min(start + placed.length, CODE_LENGTH - 1),
	};
}

export function typeAt(
	cells: string[],
	index: number,
	value: string,
): CodeEdit {
	const chars = normalizeCode(value);
	if (chars.length === 0) {
		const next = [...cells];
		next[index] = "";
		return { cells: next, focus: index };
	}
	const previous = cells[index] ?? "";
	if (previous && chars.length === 2 && chars.includes(previous)) {
		const typed = chars[0] === previous ? chars.slice(1) : chars.slice(0, 1);
		return fillFrom(cells, index, typed);
	}
	return fillFrom(cells, index, chars);
}

export function eraseAt(cells: string[], index: number): CodeEdit {
	const next = [...cells];
	if (next[index]) {
		next[index] = "";
		return { cells: next, focus: index };
	}
	const back = Math.max(index - 1, 0);
	next[back] = "";
	return { cells: next, focus: back };
}
