import { describe, expect, test } from "bun:test";
import type { ResponseBlock } from "@tripwire/contracts";
import {
	type BuilderState,
	dropIndexFor,
	dropLineIndex,
	dropPosition,
	movedIndex,
	OPEN_VIEW,
	reduceBuilder,
	reduceBuilderUi,
	verticalStep,
} from "#/lib/block-builder";

const A: ResponseBlock = { id: "a", type: "headline" };
const B: ResponseBlock = { id: "b", type: "instruction" };
const C: ResponseBlock = { id: "c", type: "run-link" };
const NEW: ResponseBlock = { id: "n", type: "text", parts: [] };

function state(extra: Partial<BuilderState> = {}): BuilderState {
	return {
		blocks: [A, B, C],
		selectedId: null,
		drag: null,
		paletteOpen: true,
		view: OPEN_VIEW,
		...extra,
	};
}

const ids = (next: BuilderState) => next.blocks.map((block) => block.id);

describe("add", () => {
	test("goes after the selected block and selects the new one", () => {
		const next = reduceBuilder(state({ selectedId: "a" }), {
			type: "add",
			block: NEW,
		});
		expect(ids(next)).toEqual(["a", "n", "b", "c"]);
		expect(next.selectedId).toBe("n");
	});

	test("goes to the end with nothing selected", () => {
		expect(ids(reduceBuilder(state(), { type: "add", block: NEW }))).toEqual([
			"a",
			"b",
			"c",
			"n",
		]);
	});

	test("an explicit index wins and is clamped", () => {
		expect(
			ids(reduceBuilder(state(), { type: "add", block: NEW, index: 0 })),
		).toEqual(["n", "a", "b", "c"]);
		expect(
			ids(reduceBuilder(state(), { type: "add", block: NEW, index: 99 })),
		).toEqual(["a", "b", "c", "n"]);
	});
});

describe("move", () => {
	test("insertion indexes count the slots between blocks", () => {
		expect(
			ids(reduceBuilder(state(), { type: "move", id: "a", index: 3 })),
		).toEqual(["b", "c", "a"]);
		expect(
			ids(reduceBuilder(state(), { type: "move", id: "c", index: 0 })),
		).toEqual(["c", "a", "b"]);
		expect(
			ids(reduceBuilder(state(), { type: "move", id: "a", index: 2 })),
		).toEqual(["b", "a", "c"]);
	});

	test("dropping a block next to itself changes nothing", () => {
		const before = state();
		expect(
			reduceBuilder(before, { type: "move", id: "b", index: 1 }).blocks,
		).toBe(before.blocks);
		expect(
			reduceBuilder(before, { type: "move", id: "b", index: 2 }).blocks,
		).toBe(before.blocks);
		expect(movedIndex(1, 1)).toBeNull();
		expect(movedIndex(1, 2)).toBeNull();
	});

	test("an unknown id changes nothing", () => {
		const before = state();
		expect(
			reduceBuilder(before, { type: "move", id: "zz", index: 0 }).blocks,
		).toBe(before.blocks);
	});
});

describe("update, remove, select", () => {
	test("update replaces by id", () => {
		const edited: ResponseBlock = {
			id: "b",
			type: "text",
			parts: [{ kind: "text", text: "hi" }],
		};
		expect(
			reduceBuilder(state(), { type: "update", block: edited }).blocks[1],
		).toBe(edited);
	});

	test("remove clears the selection only when it removes the selected block", () => {
		const removed = reduceBuilder(state({ selectedId: "b" }), {
			type: "remove",
			id: "b",
		});
		expect(ids(removed)).toEqual(["a", "c"]);
		expect(removed.selectedId).toBeNull();
		expect(
			reduceBuilder(state({ selectedId: "a" }), { type: "remove", id: "b" })
				.selectedId,
		).toBe("a");
	});

	test("select sets and clears", () => {
		expect(reduceBuilder(state(), { type: "select", id: "c" }).selectedId).toBe(
			"c",
		);
		expect(
			reduceBuilder(state({ selectedId: "c" }), { type: "select", id: null })
				.selectedId,
		).toBeNull();
	});
});

describe("drag and drop", () => {
	test("a palette drop adds at the drop line and selects", () => {
		let next = reduceBuilder(state(), {
			type: "drag-start",
			item: { source: "palette", type: "text" },
		});
		next = reduceBuilder(next, { type: "drag-over", index: 1 });
		expect(dropLineIndex(next)).toBe(1);
		next = reduceBuilder(next, { type: "drop", block: NEW, index: 1 });
		expect(ids(next)).toEqual(["a", "n", "b", "c"]);
		expect(next.selectedId).toBe("n");
		expect(next.drag).toBeNull();
	});

	test("a canvas drop moves the block", () => {
		let next = reduceBuilder(state(), {
			type: "drag-start",
			item: { source: "canvas", id: "c" },
		});
		next = reduceBuilder(next, { type: "drop", block: null, index: 0 });
		expect(ids(next)).toEqual(["c", "a", "b"]);
	});

	test("no drop line where the block already sits", () => {
		const dragging = reduceBuilder(state(), {
			type: "drag-start",
			item: { source: "canvas", id: "b" },
		});
		expect(
			dropLineIndex(reduceBuilder(dragging, { type: "drag-over", index: 1 })),
		).toBeNull();
		expect(
			dropLineIndex(reduceBuilder(dragging, { type: "drag-over", index: 2 })),
		).toBeNull();
		expect(
			dropLineIndex(reduceBuilder(dragging, { type: "drag-over", index: 3 })),
		).toBe(3);
	});

	test("a drop outside the canvas or a cancel changes nothing", () => {
		const dragging = reduceBuilder(state(), {
			type: "drag-start",
			item: { source: "palette", type: "help" },
		});
		expect(
			ids(reduceBuilder(dragging, { type: "drop", block: NEW, index: null })),
		).toEqual(["a", "b", "c"]);
		expect(reduceBuilder(dragging, { type: "drag-cancel" }).drag).toBeNull();
	});

	test("drop index reads the half of the block the pointer is in", () => {
		expect(dropIndexFor([A, B, C], "b", false)).toBe(1);
		expect(dropIndexFor([A, B, C], "b", true)).toBe(2);
		expect(dropIndexFor([A, B, C], "canvas", false)).toBe(3);
	});
});

describe("announced position", () => {
	const blocks = [A, B, C];

	test("a moved block counts where it lands, not the slot it hovers", () => {
		const item = { source: "canvas", id: "c" } as const;
		expect(dropPosition(blocks, item, 1)).toEqual({ position: 2, total: 3 });
		expect(dropPosition(blocks, item, 3)).toEqual({ position: 3, total: 3 });
		const first = { source: "canvas", id: "a" } as const;
		expect(dropPosition(blocks, first, 2)).toEqual({ position: 2, total: 3 });
	});

	test("a new block adds one to the total", () => {
		const item = { source: "palette", type: "text" } as const;
		expect(dropPosition(blocks, item, 0)).toEqual({ position: 1, total: 4 });
		expect(dropPosition(blocks, item, 3)).toEqual({ position: 4, total: 4 });
	});
});

describe("keyboard steps", () => {
	const centers = [10, 50, 90];

	test("down lands just past the next block's center", () => {
		expect(verticalStep("down", 40, 20, centers)).toBe(81);
	});

	test("up lands just before the previous block's center", () => {
		expect(verticalStep("up", 40, 20, centers)).toBe(-1);
	});

	test("stops at the ends", () => {
		expect(verticalStep("down", 90, 20, centers)).toBeNull();
		expect(verticalStep("up", -10, 20, centers)).toBeNull();
	});
});

describe("palette and preview", () => {
	test("hiding the palette clears the selection, showing keeps it", () => {
		const hidden = reduceBuilder(state({ selectedId: "b" }), {
			type: "palette",
			open: false,
		});
		expect(hidden.paletteOpen).toBe(false);
		expect(hidden.selectedId).toBeNull();
		const shown = reduceBuilder(
			state({ selectedId: "b", paletteOpen: false }),
			{
				type: "palette",
				open: true,
			},
		);
		expect(shown.selectedId).toBe("b");
	});

	test("browsing clears the selection and opens the palette", () => {
		const next = reduceBuilder(state({ selectedId: "b", paletteOpen: false }), {
			type: "browse",
		});
		expect(next.selectedId).toBeNull();
		expect(next.paletteOpen).toBe(true);
	});

	test("the ui reducer keeps its object when nothing changes", () => {
		const { blocks, ...ui } = state({ selectedId: "a" });
		expect(
			reduceBuilderUi(ui, { blocks, action: { type: "select", id: "a" } }),
		).toBe(ui);
		expect(
			reduceBuilderUi(ui, { blocks, action: { type: "remove", id: "a" } })
				.selectedId,
		).toBeNull();
	});

	test("the view changes one field at a time", () => {
		const member = reduceBuilder(state(), {
			type: "view",
			view: { viewer: "member" },
		});
		expect(member.view).toEqual({ tab: "comment", viewer: "member" });
		const check = reduceBuilder(member, {
			type: "view",
			view: { tab: "check" },
		});
		expect(check.view).toEqual({ tab: "check", viewer: "member" });
	});

	test("blocks stay the same object when only the view changes", () => {
		const before = state();
		expect(
			reduceBuilder(before, { type: "view", view: { tab: "run-page" } }).blocks,
		).toBe(before.blocks);
	});
});
