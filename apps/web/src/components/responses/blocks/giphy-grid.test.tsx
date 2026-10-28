import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { giphyGifSchema } from "@tripwire/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { GiphyGrid } from "#/components/responses/blocks/giphy-grid";
import { closeGifFrom } from "#/lib/giphy-gif";

test("the SDK grid renders a real legacy cached GIF without fabricated SDK metadata", () => {
	const gif = giphyGifSchema.parse(
		JSON.parse(
			readFileSync(
				new URL(
					"../../../../../../packages/contracts/fixtures/giphy.cached-gif.json",
					import.meta.url,
				),
				"utf8",
			),
		),
	);
	const markup = renderToStaticMarkup(
		<GiphyGrid
			columns={2}
			width={296}
			gutter={8}
			hideAttribution
			noLink
			initialGifs={[gif]}
			eagerIds={[gif.id]}
			fetchGifs={async () => ({
				data: [gif],
				pagination: { total_count: 1, count: 1, offset: 0 },
				meta: { status: 200, msg: "OK", response_id: "" },
			})}
		/>,
	);
	const chosen = closeGifFrom(gif);
	expect(markup).toContain(`data-giphy-id="${gif.id}"`);
	expect(markup).toContain("<img");
	expect(
		Object.values(gif.images).some((rendition) =>
			markup.includes(rendition.url),
		),
	).toBe(true);
	expect(markup).not.toContain("NaN");
	expect(markup).not.toContain("undefined");
	expect(chosen?.id).toBe(gif.id);
	expect(chosen?.width).toBe(200);
	expect(chosen?.height).toBe(200);
	expect(gif).not.toHaveProperty("user");
});

test("malformed optional SDK metadata cannot break rendering a usable captured GIF", () => {
	const captured = JSON.parse(
		readFileSync(
			new URL(
				"../../../../../../packages/contracts/fixtures/giphy.cached-gif.json",
				import.meta.url,
			),
			"utf8",
		),
	);
	const gif = giphyGifSchema.parse({
		...captured,
		title: "",
		user: null,
		tags: { invalid: true },
		bottle_data: null,
		alt_text: { invalid: true },
		is_sticker: "0",
		analytics_response_payload: { invalid: true },
	});
	const markup = renderToStaticMarkup(
		<GiphyGrid
			columns={2}
			width={296}
			gutter={8}
			hideAttribution
			noLink
			initialGifs={[gif]}
			eagerIds={[gif.id]}
			fetchGifs={async () => ({
				data: [gif],
				pagination: { total_count: 1, count: 1, offset: 0 },
				meta: { status: 200, msg: "OK", response_id: "" },
			})}
		/>,
	);
	expect(markup).toContain(`data-giphy-id="${gif.id}"`);
	expect(markup).toContain("<img");
	expect(gif.user).toBeUndefined();
	expect(gif.bottle_data).toBeUndefined();
	expect(gif.tags).toBeUndefined();
	expect(gif.analytics_response_payload).toBe("");
});
