const TWEMOJI_BASE =
	"https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/svg/";
const FETCH_TIMEOUT_MS = 1500;
const ZWJ = "‍";
const VS16 = /️/g;

const cache = new Map<string, string | null>();

export function twemojiCode(grapheme: string): string {
	const source = grapheme.includes(ZWJ) ? grapheme : grapheme.replace(VS16, "");
	return Array.from(source, (char) => char.codePointAt(0)?.toString(16) ?? "")
		.filter(Boolean)
		.join("-");
}

async function fetchEmoji(grapheme: string): Promise<string | null> {
	try {
		const response = await fetch(
			`${TWEMOJI_BASE}${twemojiCode(grapheme)}.svg`,
			{
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			},
		);
		if (!response.ok) {
			return null;
		}
		const svg = Buffer.from(await response.arrayBuffer()).toString("base64");
		return `data:image/svg+xml;base64,${svg}`;
	} catch {
		return null;
	}
}

export async function loadEmoji(grapheme: string): Promise<string | null> {
	const hit = cache.get(grapheme);
	if (hit !== undefined) {
		return hit;
	}
	const image = await fetchEmoji(grapheme);
	if (image) {
		cache.set(grapheme, image);
	}
	return image;
}

const AVATAR_MAX_BYTES = 512 * 1024;

export async function loadAvatar(url: string | null): Promise<string | null> {
	if (!url) {
		return null;
	}
	try {
		const response = await fetch(url, {
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});
		const type = response.headers.get("content-type") ?? "";
		if (!(response.ok && /^image\/(png|jpeg)/.test(type))) {
			return null;
		}
		const bytes = Buffer.from(await response.arrayBuffer());
		if (bytes.byteLength > AVATAR_MAX_BYTES) {
			return null;
		}
		return `data:${type.split(";")[0]};base64,${bytes.toString("base64")}`;
	} catch {
		return null;
	}
}
