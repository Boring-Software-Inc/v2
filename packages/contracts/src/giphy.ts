import { z } from "zod";
import { isGiphyMediaUrl } from "./response.ts";
import { jsonValueSchema } from "./workflow.ts";

const dimension = z
	.union([
		z
			.string()
			.regex(/^\d{1,4}$/)
			.transform(Number),
		z.number(),
	])
	.pipe(z.number().int().positive().max(2000));

export const giphyRenditionSchema = z
	.object({
		url: z.string().max(1000).refine(isGiphyMediaUrl),
		width: dimension,
		height: dimension,
		webp: z
			.string()
			.max(1000)
			.refine(isGiphyMediaUrl)
			.optional()
			.catch(undefined),
		mp4: z
			.string()
			.max(1000)
			.refine(isGiphyMediaUrl)
			.optional()
			.catch(undefined),
	})
	.catchall(jsonValueSchema);
export type GiphyRendition = z.infer<typeof giphyRenditionSchema>;

const GRID_RENDITIONS = [
	"original",
	"original_still",
	"fixed_width_still",
	"fixed_height_still",
	"fixed_width_small",
	"fixed_width_small_still",
	"fixed_height_small",
	"fixed_height_small_still",
] as const;

export const giphyImagesSchema = z
	.looseObject({
		fixed_height: giphyRenditionSchema,
		fixed_width: giphyRenditionSchema,
	})
	.transform((images) => {
		const optional: Record<string, GiphyRendition> = {};
		for (const name of GRID_RENDITIONS) {
			const rendition = giphyRenditionSchema.safeParse(images[name]);
			if (rendition.success) {
				optional[name] = rendition.data;
			}
		}
		return {
			...optional,
			fixed_height: images.fixed_height,
			fixed_width: images.fixed_width,
		};
	});
export type GiphyImages = z.infer<typeof giphyImagesSchema>;

export const giphyGifSchema = z
	.object({
		id: z
			.string()
			.min(1)
			.max(64)
			.regex(/^[A-Za-z0-9]+$/),
		rating: z.enum(["y", "g", "pg", "pg-13"]),
		title: z.string().max(500).catch(""),
		type: z.enum(["gif", "text", "video"]).optional().catch(undefined),
		is_sticker: z
			.union([z.boolean(), z.literal(0), z.literal(1)])
			.transform((value) => value === true || value === 1)
			.optional()
			.catch(undefined),
		alt_text: z.string().max(500).optional().catch(undefined),
		analytics_response_payload: z.string().catch(""),
		tags: z
			.array(
				z.union([
					z.string(),
					z.object({ text: z.string() }).transform((tag) => tag.text),
				]),
			)
			.optional()
			.catch(undefined),
		user: z
			.object({ username: z.string().optional() })
			.catchall(jsonValueSchema)
			.optional()
			.catch(undefined),
		bottle_data: z
			.object({ tags: z.array(z.string()).optional() })
			.catchall(jsonValueSchema)
			.optional()
			.catch(undefined),
		images: giphyImagesSchema,
	})
	.catchall(jsonValueSchema);
export type GiphyGifRecord = z.infer<typeof giphyGifSchema>;

export const giphyPageSchema = z.object({
	data: z.array(giphyGifSchema).max(100),
	pagination: z.object({
		total_count: z.number().int().min(0),
		count: z.number().int().min(0),
		offset: z.number().int().min(0),
	}),
	meta: z
		.object({
			status: z.number().int(),
			msg: z.string(),
			response_id: z.string(),
		})
		.catchall(jsonValueSchema),
});
export type GiphyPageRecord = z.infer<typeof giphyPageSchema>;

export const giphyUpstreamPageSchema = z.looseObject({
	data: z.array(z.unknown()),
	pagination: z
		.object({ total_count: z.unknown().optional() })
		.nullable()
		.catch(null),
	meta: z
		.object({
			status: z.number().catch(200),
			msg: z.string().catch("OK"),
			response_id: z.string().catch(""),
		})
		.catch({ status: 200, msg: "OK", response_id: "" }),
});
export type GiphyUpstreamPage = z.infer<typeof giphyUpstreamPageSchema>;

export const validGiphyGifs = z
	.array(z.unknown())
	.catch([])
	.transform((data) =>
		data.flatMap((gif) => {
			const parsed = giphyGifSchema.safeParse(gif);
			return parsed.success ? [parsed.data] : [];
		}),
	).parse;
