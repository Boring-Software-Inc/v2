import { describe, expect, test } from "bun:test";
import {
	clampParts,
	mergeParts,
} from "#/components/responses/blocks/text-parts";

describe("text parts", () => {
	test("adjacent text merges and empty text drops", () => {
		expect(
			mergeParts([
				{ kind: "text", text: "Hi " },
				{ kind: "text", text: "" },
				{ kind: "text", text: "there " },
				{ kind: "var", name: "author" },
				{ kind: "text", text: "" },
				{ kind: "var", name: "title" },
			]),
		).toEqual([
			{ kind: "text", text: "Hi there " },
			{ kind: "var", name: "author" },
			{ kind: "var", name: "title" },
		]);
	});

	test("clamping keeps variables and cuts text at the limit", () => {
		expect(
			clampParts(
				[
					{ kind: "text", text: "abcd" },
					{ kind: "var", name: "author" },
					{ kind: "text", text: "efgh" },
				],
				6,
			),
		).toEqual([
			{ kind: "text", text: "abcd" },
			{ kind: "var", name: "author" },
			{ kind: "text", text: "ef" },
		]);
	});
});
