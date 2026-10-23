import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import {
	type PickerItem,
	type PickerState,
	pickerFrame,
	pickerKey,
	runPicker,
} from "#/picker";

const ITEMS: PickerItem[] = [
	{ value: "new-accounts", label: "New accounts", hint: "live, opened" },
	{ value: "stale", label: "Stale issues", hint: "off, schedule" },
	{
		value: "broken",
		label: "Broken",
		disabled: "cannot be written as code",
	},
];

function start(selected: string[] = []): PickerState {
	return { query: "", cursor: 0, selected: new Set(selected) };
}

function frame(state: PickerState, status?: "submit" | "cancel") {
	return pickerFrame(
		{ message: "Pick workflows to pull", items: ITEMS },
		state,
		status,
	)
		.map((line) => stripVTControlCharacters(line))
		.join("\n");
}

describe("picker keys", () => {
	test("space on Select All picks every item that can be picked", () => {
		const next = pickerKey(ITEMS, start(), { name: "space" });
		expect([...next.state.selected].sort()).toEqual(["new-accounts", "stale"]);
		const cleared = pickerKey(ITEMS, next.state, { name: "space" });
		expect([...cleared.state.selected]).toEqual([]);
	});

	test("space toggles the item under the cursor, never a disabled one", () => {
		let state = start();
		state = pickerKey(ITEMS, state, { name: "down" }).state;
		state = pickerKey(ITEMS, state, { name: "space" }).state;
		expect([...state.selected]).toEqual(["new-accounts"]);
		state = pickerKey(ITEMS, state, { name: "down" }).state;
		state = pickerKey(ITEMS, state, { name: "down" }).state;
		state = pickerKey(ITEMS, state, { name: "space" }).state;
		expect([...state.selected]).toEqual(["new-accounts"]);
	});

	test("typing filters the list, backspace widens it", () => {
		let state = start();
		for (const ch of "sta") {
			state = pickerKey(ITEMS, state, { name: ch, sequence: ch }).state;
		}
		expect(state.query).toBe("sta");
		state = pickerKey(ITEMS, state, { name: "down" }).state;
		state = pickerKey(ITEMS, state, { name: "space" }).state;
		expect([...state.selected]).toEqual(["stale"]);
		state = pickerKey(ITEMS, state, { name: "backspace" }).state;
		expect(state.query).toBe("st");
	});

	test("enter submits the picks, and refuses an empty pick", () => {
		expect(pickerKey(ITEMS, start(), { name: "return" }).done).toBeUndefined();
		const done = pickerKey(ITEMS, start(["stale"]), { name: "return" });
		expect(done.done).toBe("submit");
	});

	test("escape and ctrl-c cancel", () => {
		expect(pickerKey(ITEMS, start(), { name: "escape" }).done).toBe("cancel");
		expect(pickerKey(ITEMS, start(), { name: "c", ctrl: true }).done).toBe(
			"cancel",
		);
	});
});

describe("picker frame", () => {
	test("reads like the skills.sh picker", () => {
		expect(frame(start(["new-accounts"]))).toBe(
			[
				"◆  Pick workflows to pull",
				"│  Search:  ",
				"│  ↑↓ move, space select, enter confirm",
				"│",
				"│ ❯ ◐ Select All (1/2)",
				"│   ────────────────────────────────────",
				"│   ● New accounts (live, opened)",
				"│   ○ Stale issues (off, schedule)",
				"│   - Broken (cannot be written as code)",
				"│",
				"│  Selected: New accounts",
				"└",
			].join("\n"),
		);
	});

	test("a filter with no match says so", () => {
		const state = { ...start(), query: "zzz" };
		expect(frame(state)).toContain("│  No matches found");
	});

	test("submit lists the picks, cancel strikes through", () => {
		expect(frame(start(["new-accounts", "stale"]), "submit")).toBe(
			["◇  Pick workflows to pull", "│  New accounts, Stale issues"].join("\n"),
		);
		expect(frame(start(), "cancel")).toBe(
			["■  Pick workflows to pull", "│  Cancelled"].join("\n"),
		);
	});

	test("a long list scrolls and says how many are hidden", () => {
		const many = Array.from({ length: 12 }, (_, index) => ({
			value: `w${index}`,
			label: `Workflow ${index}`,
		}));
		const text = pickerFrame(
			{ message: "Pick", items: many, maxVisible: 5 },
			start(),
		)
			.map((line) => stripVTControlCharacters(line))
			.join("\n");
		expect(text).toContain("│   ○ Workflow 4");
		expect(text).not.toContain("Workflow 5");
		expect(text).toContain("│  ↓ 7 more");
	});
});

describe("the picker in a terminal", () => {
	async function drive(keys: string[], initial: string[]) {
		const input = new PassThrough();
		let screen = "";
		const picked = runPicker(
			{ message: "Pick workflows to pull", items: ITEMS },
			initial,
			{ input, write: (text) => (screen += text), columns: () => 80 },
		);
		for (const key of keys) {
			input.write(key);
			await Bun.sleep(1);
		}
		return { picked: await picked, screen: stripVTControlCharacters(screen) };
	}

	test("arrow, space and enter pick a workflow and redraw in place", async () => {
		const { picked, screen } = await drive(
			["\x1b[B", "\x1b[B", " ", "\r"],
			["new-accounts"],
		);
		expect(picked?.sort()).toEqual(["new-accounts", "stale"]);
		expect(screen).toContain("◇  Pick workflows to pull");
		expect(screen).toContain("│  New accounts, Stale issues");
	});

	test("escape cancels with nothing picked", async () => {
		const { picked, screen } = await drive(["\x1b"], ["stale"]);
		expect(picked).toBeNull();
		expect(screen).toContain("■  Pick workflows to pull");
	});
});
