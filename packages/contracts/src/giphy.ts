import { z } from "zod";
import { isGiphyMediaUrl } from "./response.ts";

const dimension = z.union([z.string().regex(/^\d{1,4}$/), z.number().int()]);

export const giphyRenditionSchema = z.looseObject({
	url: z.string().max(1000).refine(isGiphyMediaUrl),
	width: dimension,
	height: dimension,
});

export const giphyGifSchema = z.looseObject({
	id: z
		.string()
		.min(1)
		.max(64)
		.regex(/^[A-Za-z0-9]+$/),
	rating: z.enum(["y", "g", "pg", "pg-13"]),
	title: z.string().max(500).catch(""),
	images: z.looseObject({
		fixed_height: giphyRenditionSchema,
		fixed_width: giphyRenditionSchema,
	}),
});
export type GiphyGifRecord = z.infer<typeof giphyGifSchema>;

export const giphyPageSchema = z.object({
	data: z.array(giphyGifSchema).max(100),
	pagination: z.object({
		total_count: z.number().int().min(0),
		count: z.number().int().min(0),
		offset: z.number().int().min(0),
	}),
	meta: z.looseObject({
		status: z.number().int(),
		msg: z.string(),
		response_id: z.string(),
	}),
});
export type GiphyPageRecord = z.infer<typeof giphyPageSchema>;

export function validGiphyGifs(data: unknown): GiphyGifRecord[] {
	if (!Array.isArray(data)) {
		return [];
	}
	return data.flatMap((gif) => {
		const parsed = giphyGifSchema.safeParse(gif);
		return parsed.success ? [parsed.data] : [];
	});
}
