import type { RunView } from "#/lib/runs.functions";

export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;
export const APP_OG_IMAGE_PATH = "/og.png";
export const APP_OG_VIDEO_PATH = "/og/site.mp4";

const RUN_OG_VERSION = 1;
const RUN_OG_PATH = /^\/og\/runs\/([^/]+)\/([^/]+)$/;
const TITLE_MAX_GRAPHEMES = 90;
const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

export interface RunOgCard {
	repo: string;
	number: number | null;
	title: string;
	author: string | null;
	avatarUrl: string | null;
}

export interface OgImage {
	path: string;
	width: number;
	height: number;
	video?: string;
}

export const APP_OG_IMAGE: OgImage = {
	path: APP_OG_IMAGE_PATH,
	width: OG_IMAGE_WIDTH,
	height: OG_IMAGE_HEIGHT,
};

export const SITE_OG_IMAGE: OgImage = {
	...APP_OG_IMAGE,
	video: APP_OG_VIDEO_PATH,
};

function graphemes(text: string): string[] {
	const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
	return Array.from(segmenter.segment(text), (part) => part.segment);
}

export function normalizeOgTitle(title: string): string {
	const collapsed = title.replaceAll(/\s+/g, " ").trim();
	const parts = graphemes(collapsed);
	if (parts.length <= TITLE_MAX_GRAPHEMES) {
		return collapsed;
	}
	return parts.slice(0, TITLE_MAX_GRAPHEMES).join("").trimEnd();
}

export function dropUnsupportedWords(
	text: string,
	unsupported: string[],
): string {
	const blocked = new Set(unsupported.flatMap(graphemes));
	if (blocked.size === 0) {
		return text;
	}
	return text
		.split(" ")
		.filter((word) => !graphemes(word).some((part) => blocked.has(part)))
		.join(" ")
		.replaceAll(/\s+/g, " ")
		.trim();
}

export interface FittedTitle {
	text: string;
	fade: boolean;
}

export async function fitOgTitle(
	title: string,
	maxWidth: number,
	measure: (text: string) => number | Promise<number>,
): Promise<FittedTitle> {
	const text = normalizeOgTitle(title);
	return { text, fade: (await measure(text)) > maxWidth };
}

function avatarUrlFor(forge: RunView["forge"], login: string | null) {
	if (forge !== "github" || !login || !GITHUB_LOGIN.test(login)) {
		return null;
	}
	return `https://github.com/${login}.png?size=80`;
}

export function runOgCard(view: RunView | null): RunOgCard | null {
	if (view?.access !== "public") {
		return null;
	}
	const title = view.event?.title?.trim();
	if (!title) {
		return null;
	}
	const author = view.event?.actor ?? null;
	return {
		repo: view.repoFullName,
		number: view.subjectNumber,
		title: normalizeOgTitle(title),
		author,
		avatarUrl: avatarUrlFor(view.forge, author),
	};
}

function hashString(input: string): string {
	let h1 = 0xdeadbeef;
	let h2 = 0x41c6ce57;
	for (let index = 0; index < input.length; index++) {
		const code = input.charCodeAt(index);
		h1 = Math.imul(h1 ^ code, 2654435761);
		h2 = Math.imul(h2 ^ code, 1597334677);
	}
	h1 =
		Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
		Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 =
		Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
		Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return (
		(h2 >>> 0).toString(36).padStart(7, "0") +
		(h1 >>> 0).toString(36).padStart(7, "0")
	);
}

export function runOgHash(card: RunOgCard): string {
	return hashString(
		JSON.stringify([
			RUN_OG_VERSION,
			card.repo,
			card.number,
			card.title,
			card.author,
			card.avatarUrl,
		]),
	);
}

export function runOgImage(runId: string, view: RunView | null): OgImage {
	const card = runOgCard(view);
	if (!card) {
		return APP_OG_IMAGE;
	}
	return {
		path: `/og/runs/${encodeURIComponent(runId)}/${runOgHash(card)}`,
		width: OG_IMAGE_WIDTH,
		height: OG_IMAGE_HEIGHT,
	};
}

export function parseRunOgPath(
	pathname: string,
): { runId: string; hash: string } | null {
	const match = RUN_OG_PATH.exec(pathname);
	if (!(match?.[1] && match[2])) {
		return null;
	}
	try {
		return { runId: decodeURIComponent(match[1]), hash: match[2] };
	} catch {
		return null;
	}
}
