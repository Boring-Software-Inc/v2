import { Resvg } from "@resvg/resvg-js";
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

const GROUND = "#FBFBFA";
const LINE = "#05050514";
const CROSS = "#05050540";
const INK = "#050505CC";
const INK_STRONG = "#050505E6";
const INK_MUTED = "#05050599";
const TITLE_WIDTH = 864;
const TITLE_STYLE = {
	fontFamily: "Geist",
	fontSize: 48,
	fontWeight: 500,
	letterSpacing: -1.68,
	lineHeight: "58px",
} as const;
const PROBE_WIDTH = 4000;
function TitleText({ text }: { text: string }) {
	return (
		<div
			style={{
				...TITLE_STYLE,
				flexShrink: 0,
				whiteSpace: "nowrap",
				color: INK_STRONG,
			}}
		>
			{text}
		</div>
	);
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
	const svg = await satori(<TitleText text={text} />, {
		width: PROBE_WIDTH,
		height: 58,
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
	const fitted = await fitOgTitle(text, TITLE_WIDTH, async (candidate) =>
		candidate === normalized && emoji.length === 0
			? first.width
			: (await probeTitle(candidate, assets, graphemeImages)).width,
	);
	return { ...fitted, graphemeImages };
}

function Cross({ left, top }: { left: number; top: number }) {
	return (
		<svg
			aria-hidden="true"
			width="21"
			height="21"
			viewBox="0 0 21 21"
			style={{ position: "absolute", left, top }}
		>
			<path d="M10.5 1v19M1 10.5h19" stroke={CROSS} />
		</svg>
	);
}

function Rule({
	left,
	top,
	width,
	height,
}: {
	left: number;
	top: number;
	width: number;
	height: number;
}) {
	return (
		<div
			style={{
				position: "absolute",
				left,
				top,
				width,
				height,
				backgroundColor: LINE,
			}}
		/>
	);
}

function Lockup() {
	return (
		<div
			style={{
				position: "absolute",
				left: 148,
				top: 19,
				display: "flex",
				alignItems: "center",
				gap: 10,
			}}
		>
			<svg
				aria-hidden="true"
				width="30"
				height="30"
				viewBox="0 178.093 71.005 71.005"
			>
				<path
					d="M32.185 215.044L32.628 215.044 32.406 215.429 30.755 218.299 31.125 218.514 33.615 219.957 34.445 218.514 35.266 217.086 35.488 216.702 35.709 217.086 36.53 218.514 37.36 219.957 39.85 218.514 40.22 218.3 38.569 215.429 38.348 215.044 38.79 215.044 40.537 215.044 42.093 215.044 42.093 211.73 40.537 211.73 38.79 211.73 38.348 211.73 38.569 211.345 40.22 208.474 39.993 208.343 37.36 206.817 36.482 208.343 35.709 209.688 35.488 210.072 35.266 209.688 34.492 208.343 33.615 206.817 30.982 208.343 30.755 208.474 32.406 211.345 32.627 211.73 32.185 211.73 30.403 211.73 28.882 211.73 28.882 215.044 30.403 215.044 32.185 215.044Z"
					fill={INK}
				/>
				<path
					d="M40.545 234.355L30.431 234.355L30.431 228.644L30.403 228.644L20.268 228.644L10.134 228.644L10.134 218.473L0 218.473L0 208.301L10.134 208.301L10.134 198.13L20.268 198.13L30.403 198.13L30.431 198.13L30.431 192.501L40.545 192.501L40.545 198.13L50.67 198.13L60.804 198.13L60.804 208.301L70.939 208.301L70.939 218.473L60.804 218.473L60.804 228.644L50.67 228.644L40.545 228.644L40.545 234.355ZM49.758 208.301C46.601 206.174 43.514 204.861 40.537 204.19C36.977 203.388 33.576 203.504 30.403 204.244C27.071 205.022 23.99 206.487 21.242 208.301L20.268 208.968C18.403 210.291 16.704 211.766 15.201 213.274C16.495 214.65 18.213 216.133 20.268 217.499C20.77 217.832 21.291 218.157 21.831 218.473C24.328 219.932 27.227 221.168 30.403 221.853C33.55 222.532 36.969 222.67 40.537 221.946C43.347 221.375 46.248 220.269 49.183 218.473C49.678 218.17 50.174 217.847 50.67 217.504C52.356 216.339 54.049 214.939 55.738 213.274C54.034 211.581 52.343 210.144 50.67 208.938C50.365 208.718 50.061 208.506 49.758 208.301Z"
					fill={INK}
				/>
			</svg>
			<div
				style={{
					color: INK,
					fontSize: 26,
					fontWeight: 500,
					letterSpacing: -0.26,
					lineHeight: "30px",
				}}
			>
				tripwire
			</div>
		</div>
	);
}

function Frame({ assets }: { assets: RunOgAssets }) {
	return (
		<>
			<img
				alt=""
				src={assets.fireLeft}
				width={120}
				height={630}
				style={{ position: "absolute", left: 0, top: 0 }}
			/>
			<img
				alt=""
				src={assets.fireRight}
				width={120}
				height={630}
				style={{ position: "absolute", left: 1080, top: 0 }}
			/>
			<Rule left={120} top={0} width={1} height={630} />
			<Rule left={1079} top={0} width={1} height={630} />
			<Rule left={0} top={68} width={1200} height={1} />
			<Rule left={0} top={530} width={1200} height={1} />
			<Cross left={110} top={58} />
			<Cross left={1069} top={58} />
			<Cross left={110} top={520} />
			<Cross left={1069} top={520} />
		</>
	);
}

function Avatar({ src }: { src: string | null }) {
	const ring = { boxShadow: `0 0 0 1px ${LINE}`, borderRadius: 999 };
	if (src) {
		return <img alt="" src={src} width={40} height={40} style={ring} />;
	}
	return (
		<div
			style={{ ...ring, width: 40, height: 40, backgroundColor: "#EDEDEC" }}
		/>
	);
}

export async function renderRunOg(
	card: RunOgCard,
	assets: RunOgAssets,
	avatar: string | null,
): Promise<Uint8Array> {
	const fitted = await prepareTitle(card.title, assets);
	const svg = await satori(
		<div
			style={{
				position: "relative",
				display: "flex",
				width: OG_IMAGE_WIDTH,
				height: OG_IMAGE_HEIGHT,
				backgroundColor: GROUND,
				fontFamily: "Geist",
			}}
		>
			<Frame assets={assets} />
			<Lockup />
			<div
				style={{
					position: "absolute",
					left: 168,
					top: 240,
					width: TITLE_WIDTH,
					display: "flex",
					flexDirection: "column",
					gap: 18,
				}}
			>
				<div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
					<div style={{ color: INK_MUTED, fontSize: 26, lineHeight: "32px" }}>
						{card.repo}
					</div>
					{card.number === null ? null : (
						<div
							style={{
								color: INK,
								fontSize: 26,
								fontWeight: 500,
								lineHeight: "32px",
							}}
						>
							{`#${card.number}`}
						</div>
					)}
				</div>
				<div
					style={{
						position: "relative",
						display: "flex",
						width: TITLE_WIDTH,
						height: 58,
						overflow: "hidden",
					}}
				>
					<TitleText text={fitted.text} />
					{fitted.fade ? (
						<div
							style={{
								position: "absolute",
								right: 0,
								top: 0,
								width: 160,
								height: 58,
								backgroundImage: `linear-gradient(90deg, ${GROUND}00 0%, ${GROUND} 100%)`,
							}}
						/>
					) : null}
				</div>
			</div>
			{card.author ? (
				<div
					style={{
						position: "absolute",
						left: 168,
						top: 560,
						height: 40,
						display: "flex",
						alignItems: "center",
						gap: 14,
					}}
				>
					<Avatar src={avatar} />
					<div
						style={{
							color: INK,
							fontSize: 24,
							fontWeight: 500,
							lineHeight: "30px",
						}}
					>
						{card.author}
					</div>
				</div>
			) : null}
		</div>,
		{
			width: OG_IMAGE_WIDTH,
			height: OG_IMAGE_HEIGHT,
			fonts: fonts(assets),
			graphemeImages: fitted.graphemeImages,
		},
	);
	return new Resvg(svg, { fitTo: { mode: "original" } }).render().asPng();
}
