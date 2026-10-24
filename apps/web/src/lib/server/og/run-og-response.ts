import {
	APP_OG_IMAGE_PATH,
	type RunOgCard,
	runOgCard,
	runOgHash,
	runOgImage,
} from "#/lib/run-og";
import type { RunView } from "#/lib/runs.functions";

export interface RunOgDeps {
	loadView: (runId: string) => Promise<RunView | null>;
	render: (card: RunOgCard) => Promise<Uint8Array>;
}

const IMAGE_HASH = /^[a-z0-9]{1,32}$/;
const IMMUTABLE = "public, max-age=31536000, immutable";
const SHORT = "public, max-age=300";

function redirect(location: string): Response {
	return new Response(null, {
		status: 302,
		headers: { location, "cache-control": SHORT },
	});
}

export async function runOgResponse(
	runId: string,
	hash: string,
	deps: RunOgDeps,
): Promise<Response> {
	if (!IMAGE_HASH.test(hash)) {
		return redirect(APP_OG_IMAGE_PATH);
	}
	const view = await deps.loadView(runId).catch(() => null);
	const card = runOgCard(view);
	if (!card) {
		return redirect(APP_OG_IMAGE_PATH);
	}
	if (runOgHash(card) !== hash) {
		return redirect(runOgImage(runId, view).path);
	}
	const png = await deps.render(card).catch(() => null);
	if (!png) {
		return redirect(APP_OG_IMAGE_PATH);
	}
	return new Response(new Uint8Array(png), {
		status: 200,
		headers: {
			"content-type": "image/png",
			"content-length": String(png.byteLength),
			"cache-control": IMMUTABLE,
		},
	});
}
