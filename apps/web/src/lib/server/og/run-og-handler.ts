import { type OgFormat, type RunOgCard, runOgHash } from "#/lib/run-og";
import { getDb } from "#/lib/server/db";
import { promiseCache } from "#/lib/server/og/promise-cache";
import { loadAvatar } from "#/lib/server/og/remote-assets";
import { renderRunOg } from "#/lib/server/og/render-run-og";
import { RUN_OG_ASSETS } from "#/lib/server/og/run-og-assets";
import { runOgResponse } from "#/lib/server/og/run-og-response";
import { renderRunOgVideo } from "#/lib/server/og/run-og-video";
import { loadRunView } from "#/lib/server/run-view";

const ANONYMOUS = { authEnabled: true, userId: null };
const RECENT_VIDEOS = 12;

const videos = promiseCache<Uint8Array>(RECENT_VIDEOS);

async function render(card: RunOgCard, format: OgFormat): Promise<Uint8Array> {
	if (format === "mp4") {
		return await videos(runOgHash(card), async () =>
			renderRunOgVideo(card, RUN_OG_ASSETS, await loadAvatar(card.avatarUrl)),
		);
	}
	return await renderRunOg(
		card,
		RUN_OG_ASSETS,
		await loadAvatar(card.avatarUrl),
	);
}

export async function handleRunOgRequest(
	runId: string,
	hash: string,
	format: OgFormat,
): Promise<Response> {
	return await runOgResponse(
		runId,
		hash,
		{
			loadView: (id) => loadRunView(getDb().db, id, ANONYMOUS),
			render,
		},
		format,
	);
}
