import { emitKeypressEvents } from "node:readline";
import { stripVTControlCharacters } from "node:util";
import pc from "picocolors";

export interface PickerItem {
	value: string;
	label: string;
	hint?: string;
	disabled?: string;
}

export interface PickerOptions {
	message: string;
	items: readonly PickerItem[];
	maxVisible?: number;
}

export interface PickerState {
	query: string;
	cursor: number;
	selected: ReadonlySet<string>;
}

export interface PickerKey {
	name?: string;
	sequence?: string;
	ctrl?: boolean;
	meta?: boolean;
}

export type PickerStatus = "submit" | "cancel";

export interface PickerStep {
	state: PickerState;
	done?: PickerStatus;
}

const BAR = pc.dim("│");
const RULE = pc.dim("─");

function pickable(items: readonly PickerItem[]): PickerItem[] {
	return items.filter((item) => item.disabled === undefined);
}

function matches(item: PickerItem, query: string): boolean {
	const q = query.toLowerCase();
	return (
		item.label.toLowerCase().includes(q) || item.value.toLowerCase().includes(q)
	);
}

function filtered(items: readonly PickerItem[], query: string): PickerItem[] {
	return query ? items.filter((item) => matches(item, query)) : [...items];
}

type AllState = "none" | "partial" | "all";

function allState(
	items: readonly PickerItem[],
	selected: ReadonlySet<string>,
): AllState {
	const open = pickable(items);
	const count = open.filter((item) => selected.has(item.value)).length;
	if (count === 0) {
		return "none";
	}
	return count === open.length ? "all" : "partial";
}

export function pickerKey(
	items: readonly PickerItem[],
	state: PickerState,
	key: PickerKey,
): PickerStep {
	const shown = filtered(items, state.query);
	if (key.name === "return") {
		return state.selected.size > 0 ? { state, done: "submit" } : { state };
	}
	if (key.name === "escape" || (key.ctrl && key.name === "c")) {
		return { state, done: "cancel" };
	}
	if (key.name === "up") {
		return { state: { ...state, cursor: Math.max(0, state.cursor - 1) } };
	}
	if (key.name === "down") {
		return {
			state: { ...state, cursor: Math.min(shown.length, state.cursor + 1) },
		};
	}
	if (key.name === "space") {
		const selected = new Set(state.selected);
		if (state.cursor === 0) {
			const clear = allState(items, selected) === "all";
			for (const item of pickable(items)) {
				if (clear) {
					selected.delete(item.value);
				} else {
					selected.add(item.value);
				}
			}
		} else {
			const item = shown[state.cursor - 1];
			if (item && item.disabled === undefined) {
				if (selected.has(item.value)) {
					selected.delete(item.value);
				} else {
					selected.add(item.value);
				}
			}
		}
		return { state: { ...state, selected } };
	}
	if (key.name === "backspace") {
		return { state: { ...state, query: state.query.slice(0, -1), cursor: 0 } };
	}
	if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
		return {
			state: { ...state, query: state.query + key.sequence, cursor: 0 },
		};
	}
	return { state };
}

function itemLine(
	item: PickerItem,
	isCursor: boolean,
	selected: ReadonlySet<string>,
): string {
	const prefix = isCursor ? pc.cyan("❯") : " ";
	if (item.disabled !== undefined) {
		const label = isCursor ? pc.underline(item.label) : item.label;
		return `${BAR} ${prefix} ${pc.dim(`- ${label} (${item.disabled})`)}`;
	}
	const radio = selected.has(item.value) ? pc.green("●") : pc.dim("○");
	const label = isCursor ? pc.underline(item.label) : item.label;
	const hint = item.hint ? pc.dim(` (${item.hint})`) : "";
	return `${BAR} ${prefix} ${radio} ${label}${hint}`;
}

function selectedLabels(
	items: readonly PickerItem[],
	selected: ReadonlySet<string>,
): string[] {
	return items
		.filter((item) => selected.has(item.value))
		.map((item) => item.label);
}

export function pickerFrame(
	options: PickerOptions,
	state: PickerState,
	status?: PickerStatus,
): string[] {
	const { message, items, maxVisible = 8 } = options;
	if (status === "submit") {
		return [
			`${pc.green("◇")}  ${pc.bold(message)}`,
			`${BAR}  ${pc.dim(selectedLabels(items, state.selected).join(", "))}`,
		];
	}
	if (status === "cancel") {
		return [
			`${pc.red("■")}  ${pc.bold(message)}`,
			`${BAR}  ${pc.strikethrough(pc.dim("Cancelled"))}`,
		];
	}
	const shown = filtered(items, state.query);
	const lines = [
		`${pc.green("◆")}  ${pc.bold(message)}`,
		`${BAR}  ${pc.dim("Search:")} ${state.query}${pc.inverse(" ")}`,
		`${BAR}  ${pc.dim("↑↓ move, space select, enter confirm")}`,
		BAR,
	];
	const open = pickable(items);
	const count = open.filter((item) => state.selected.has(item.value)).length;
	const all = allState(items, state.selected);
	const radio =
		all === "all"
			? pc.green("●")
			: all === "partial"
				? pc.yellow("◐")
				: pc.dim("○");
	const onAll = state.cursor === 0;
	lines.push(
		`${BAR} ${onAll ? pc.cyan("❯") : " "} ${radio} ${
			onAll ? pc.underline(pc.bold("Select All")) : pc.bold("Select All")
		} ${pc.dim(`(${count}/${open.length})`)}`,
		`${BAR}   ${RULE.repeat(36)}`,
	);
	if (shown.length === 0) {
		lines.push(`${BAR}  ${pc.dim("No matches found")}`);
	} else {
		const entry = state.cursor - 1;
		const start = Math.max(
			0,
			Math.min(entry - Math.floor(maxVisible / 2), shown.length - maxVisible),
		);
		const end = Math.min(shown.length, start + maxVisible);
		shown.slice(start, end).forEach((item, index) => {
			lines.push(itemLine(item, start + index === entry, state.selected));
		});
		const hidden = [
			start > 0 ? `↑ ${start} more` : "",
			end < shown.length ? `↓ ${shown.length - end} more` : "",
		].filter(Boolean);
		if (hidden.length > 0) {
			lines.push(`${BAR}  ${pc.dim(hidden.join("  "))}`);
		}
	}
	const labels = selectedLabels(items, state.selected);
	lines.push(BAR);
	if (labels.length === 0) {
		lines.push(`${BAR}  ${pc.dim("Selected: (none)")}`);
	} else {
		const summary =
			labels.length <= 3
				? labels.join(", ")
				: `${labels.slice(0, 3).join(", ")} +${labels.length - 3} more`;
		lines.push(`${BAR}  ${pc.green("Selected:")} ${summary}`);
	}
	lines.push(pc.dim("└"));
	return lines;
}

export type PickerInput = NodeJS.ReadableStream & {
	isTTY?: boolean;
	setRawMode?(mode: boolean): unknown;
};

export interface PickerIo {
	input: PickerInput;
	write(text: string): void;
	columns(): number;
}

function rowsFor(lines: readonly string[], columns: number): number {
	const width = Math.max(1, columns);
	return lines.reduce(
		(sum, line) =>
			sum +
			Math.max(1, Math.ceil(stripVTControlCharacters(line).length / width)),
		0,
	);
}

export function runPicker(
	options: PickerOptions,
	initial: readonly string[],
	io: PickerIo,
): Promise<string[] | null> {
	return new Promise((resolve) => {
		let state: PickerState = {
			query: "",
			cursor: 0,
			selected: new Set(initial),
		};
		let height = 0;
		const draw = (status?: PickerStatus) => {
			const lines = pickerFrame(options, state, status);
			const clear = height > 0 ? `\x1b[${height}A\x1b[J` : "";
			io.write(`${clear}${lines.join("\n")}\n`);
			height = rowsFor(lines, io.columns());
		};
		const finish = (status: PickerStatus) => {
			draw(status);
			io.input.off("keypress", onKey);
			io.input.off("end", onEnd);
			if (io.input.isTTY) {
				io.input.setRawMode?.(false);
			}
			io.input.pause();
			resolve(status === "submit" ? [...state.selected] : null);
		};
		const onKey = (_text: string | undefined, key: PickerKey | undefined) => {
			if (!key) {
				return;
			}
			const next = pickerKey(options.items, state, key);
			state = next.state;
			if (next.done) {
				finish(next.done);
				return;
			}
			draw();
		};
		const onEnd = () => finish("cancel");
		emitKeypressEvents(io.input);
		if (io.input.isTTY) {
			io.input.setRawMode?.(true);
		}
		io.input.on("keypress", onKey);
		io.input.on("end", onEnd);
		io.input.resume();
		draw();
	});
}
