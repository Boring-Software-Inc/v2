import { describe, expect, test } from "bun:test";
import {
	clampParts,
	fitParts,
	mergeParts,
	textLength,
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

	test("fitting reports when it had to trim text or parts", () => {
		const parts = [
			{ kind: "text", text: "abcdef" },
			{ kind: "var", name: "author" },
		] as const;
		expect(fitParts([...parts], 10, 5)).toEqual({
			parts: [...parts],
			trimmed: false,
		});
		expect(fitParts([...parts], 4, 5)).toEqual({
			parts: [
				{ kind: "text", text: "abcd" },
				{ kind: "var", name: "author" },
			],
			trimmed: true,
		});
		expect(fitParts([...parts], 10, 1)).toEqual({
			parts: [{ kind: "text", text: "abcdef" }],
			trimmed: true,
		});
		expect(textLength([...parts])).toBe(6);
	});
});
