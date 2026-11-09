import { describe, expect, test } from "bun:test";
import {
	BLOCK_META,
	newBlock,
} from "#/components/responses/blocks/block-catalog";

describe("newBlock", () => {
	test("help starts without freezing the generated default", () => {
		expect(newBlock("help", "help-1")).toEqual({
			id: "help-1",
			type: "help",
		});
	});

	test("every picker block explains what it adds", () => {
		for (const meta of Object.values(BLOCK_META)) {
			expect(meta.description.trim().length).toBeGreaterThan(0);
		}
	});
});
