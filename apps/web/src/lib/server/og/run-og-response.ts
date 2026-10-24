import {
	APP_OG_IMAGE,
	type OgFormat,
	type RunOgCard,
	runOgCard,
	runOgHash,
	runOgImage,
} from "#/lib/run-og";
import type { RunView } from "#/lib/runs.functions";

export interface RunOgDeps {
	loadView: (runId: string) => Promise<RunView | null>;
	render: (card: RunOgCard, format: OgFormat) => Promise<Uint8Array>;
}

const IMAGE_HASH = /^[a-z0-9]{1,32}$/;
const IMMUTABLE = "public, max-age=31536000, immutable";
const SHORT = "public, max-age=300";
const CONTENT_TYPE = {
	png: "image/png",
	mp4: "video/mp4",
} satisfies Record<OgFormat, string>;

function redirect(location: string): Response {
	return new Response(null, {
		status: 302,
		headers: { location, "cache-control": SHORT },
	});
}

function pathFor(format: OgFormat, image = APP_OG_IMAGE): string {
	return format === "mp4" ? image.video : image.path;
}

export async function runOgResponse(
	runId: string,
	hash: string,
	deps: RunOgDeps,
	format: OgFormat = "png",
): Promise<Response> {
	const fallback = pathFor(format);
	if (!IMAGE_HASH.test(hash)) {
		return redirect(fallback);
	}
	const view = await deps.loadView(runId).catch(() => null);
	const card = runOgCard(view);
	if (!card) {
		return redirect(fallback);
	}
	if (runOgHash(card) !== hash) {
		return redirect(pathFor(format, runOgImage(runId, view)));
	}
	const bytes = await deps.render(card, format).catch(() => null);
	if (!bytes) {
		return redirect(fallback);
	}
	return new Response(new Uint8Array(bytes), {
		status: 200,
		headers: {
			"content-type": CONTENT_TYPE[format],
			"content-length": String(bytes.byteLength),
			"cache-control": IMMUTABLE,
		},
	});
}
