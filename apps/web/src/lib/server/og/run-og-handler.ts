import type { RunOgCard } from "#/lib/run-og";
import { getDb } from "#/lib/server/db";
import { loadAvatar } from "#/lib/server/og/remote-assets";
import { renderRunOg } from "#/lib/server/og/render-run-og";
import { RUN_OG_ASSETS } from "#/lib/server/og/run-og-assets";
import { runOgResponse } from "#/lib/server/og/run-og-response";
import { loadRunView } from "#/lib/server/run-view";

const ANONYMOUS = { authEnabled: true, userId: null };

async function render(card: RunOgCard): Promise<Uint8Array> {
	return await renderRunOg(
		card,
		RUN_OG_ASSETS,
		await loadAvatar(card.avatarUrl),
	);
}

export async function handleRunOgRequest(
	runId: string,
	hash: string,
): Promise<Response> {
	return await runOgResponse(runId, hash, {
		loadView: (id) => loadRunView(getDb().db, id, ANONYMOUS),
		render,
	});
}
