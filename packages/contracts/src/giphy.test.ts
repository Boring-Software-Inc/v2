import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { giphyGifSchema, validGiphyGifs } from "./giphy.ts";

const captured = readFileSync(
	new URL("../fixtures/giphy.cached-gif.json", import.meta.url),
	"utf8",
);
const legacyGif = () => giphyGifSchema.parse(JSON.parse(captured));

describe("captured legacy GIPHY cache", () => {
	test("coerces real dimensions and preserves the provider identity and media", () => {
		const gif = legacyGif();
		expect(captured).toContain('"width": "200"');
		expect(gif.id).toBe("wMohyc8uxvtXqT9vJK");
		expect(gif.images.fixed_width.width).toBe(200);
		expect(gif.images.fixed_width.height).toBe(200);
		expect(captured).toContain(gif.images.fixed_width.url);
		expect(giphyGifSchema.parse(gif)).toEqual(gif);
		expect(gif).not.toHaveProperty("user");
	});

	test.each([
		0,
		-1,
		2001,
		0.5,
		Infinity,
		NaN,
		"",
		"200px",
	])("rejects an unusable required dimension: %s", (width) => {
		const gif = legacyGif();
		expect(
			validGiphyGifs([
				{
					...gif,
					images: {
						...gif.images,
						fixed_width: { ...gif.images.fixed_width, width },
					},
				},
			]),
		).toEqual([]);
	});

	test("does not invent a missing identity or required rendition", () => {
		const gif = legacyGif();
		const { fixed_width: _fixedWidth, ...images } = gif.images;
		expect(validGiphyGifs([{ ...gif, images }])).toEqual([]);
		expect(validGiphyGifs([{ ...gif, id: "" }])).toEqual([]);
	});

	test("discards unsafe optional media without losing usable renditions", () => {
		const gif = legacyGif();
		const parsed = giphyGifSchema.parse({
			...gif,
			images: {
				...gif.images,
				original: {
					...gif.images.fixed_width,
					url: "https://evil.example/image.gif",
				},
				fixed_width: {
					...gif.images.fixed_width,
					webp: "https://evil.example/image.webp",
				},
			},
		});
		expect(parsed.images).not.toHaveProperty("original");
		expect(parsed.images.fixed_width.webp).toBeUndefined();
		expect(parsed.images.fixed_width.url).toBe(gif.images.fixed_width.url);
	});
});
