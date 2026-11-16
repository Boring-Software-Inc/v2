import { Resvg } from "@resvg/resvg-js";
import {
	TRIPWIRE_OG_METRICS,
	TripwireOgAuthor,
	TripwireOgCanvas,
	TripwireOgFrame,
	TripwireOgLockup,
	TripwireOgRepo,
	TripwireOgTitle,
	TripwireOgTitleBlock,
	TripwireOgTitleWindow,
} from "@tripwire/ui/og";
import satori from "satori";
import {
	dropUnsupportedWords,
	fitOgTitle,
	normalizeOgTitle,
	OG_IMAGE_HEIGHT,
	OG_IMAGE_WIDTH,
	type RunOgCard,
} from "#/lib/run-og";
import { loadEmoji } from "#/lib/server/og/remote-assets";

export interface RunOgAssets {
	geistRegular: Buffer;
	geistMedium: Buffer;
	fireLeft: string;
	fireRight: string;
}

function fonts(assets: RunOgAssets) {
	return [
		{ name: "Geist", data: assets.geistRegular, weight: 400 as const },
		{ name: "Geist", data: assets.geistMedium, weight: 500 as const },
	];
}

type GraphemeImages = Record<string, string>;

interface MissingGlyphs {
	emoji: string[];
	other: string[];
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

async function probeTitle(
	text: string,
	assets: RunOgAssets,
	graphemeImages: GraphemeImages,
) {
	const missing: MissingGlyphs = { emoji: [], other: [] };
	const svg = await satori(<TripwireOgTitle text={text} />, {
		width: TRIPWIRE_OG_METRICS.probeWidth,
		height: TRIPWIRE_OG_METRICS.titleHeight,
		fonts: fonts(assets),
		graphemeImages,
		loadAdditionalAsset: async (code, segment) => {
			missing[code === "emoji" ? "emoji" : "other"].push(segment);
			return [];
		},
	});
	const box = new Resvg(svg).getBBox();
	return { width: box ? box.x + box.width : 0, missing };
}

async function prepareTitle(title: string, assets: RunOgAssets) {
	const normalized = normalizeOgTitle(title);
	const first = await probeTitle(normalized, assets, {});
	const graphemeImages: GraphemeImages = {};
	const unsupported = [...first.missing.other];
	const emoji = first.missing.emoji.flatMap((segment) =>
		Array.from(segmenter.segment(segment), (part) => part.segment),
	);
	for (const grapheme of new Set(emoji)) {
		const image = await loadEmoji(grapheme);
		if (image) {
			graphemeImages[grapheme] = image;
		} else {
			unsupported.push(grapheme);
		}
	}
	const text = dropUnsupportedWords(normalized, unsupported);
	const fitted = await fitOgTitle(
		text,
		TRIPWIRE_OG_METRICS.titleWidth,
		async (candidate) =>
			candidate === normalized && emoji.length === 0
				? first.width
				: (await probeTitle(candidate, assets, graphemeImages)).width,
	);
	return { ...fitted, graphemeImages };
}

export async function renderRunOg(
	card: RunOgCard,
	assets: RunOgAssets,
	avatar: string | null,
): Promise<Uint8Array> {
	const fitted = await prepareTitle(card.title, assets);
	const svg = await satori(
		<TripwireOgCanvas>
			<TripwireOgFrame
				fireLeft={assets.fireLeft}
				fireRight={assets.fireRight}
			/>
			<TripwireOgLockup />
			<TripwireOgTitleBlock>
				<TripwireOgRepo number={card.number} repo={card.repo} />
				<TripwireOgTitleWindow fade={fitted.fade}>
					<TripwireOgTitle text={fitted.text} />
				</TripwireOgTitleWindow>
			</TripwireOgTitleBlock>
			{card.author ? (
				<TripwireOgAuthor avatar={avatar} name={card.author} />
			) : null}
		</TripwireOgCanvas>,
		{
			width: OG_IMAGE_WIDTH,
			height: OG_IMAGE_HEIGHT,
			fonts: fonts(assets),
			graphemeImages: fitted.graphemeImages,
		},
	);
	return new Resvg(svg, { fitTo: { mode: "original" } }).render().asPng();
}
