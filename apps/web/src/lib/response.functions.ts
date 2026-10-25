import { createServerFn } from "@tanstack/react-start";
import type {
	CloseGif,
	OrgResponseDefaults,
	RedactionPolicy,
	ResponseBlock,
	ResponseConfig,
} from "@tripwire/contracts";
import {
	orgResponseDefaultsSchema,
	responseConfigSchema,
} from "@tripwire/contracts";
import type { RedactionUsage } from "@tripwire/db";
import { accessGuardMiddleware } from "#/lib/server/gated-server-fn";
import type { GiphyPage } from "#/lib/server/giphy-search";
import {
	type OrgContext,
	orgPermissionMiddleware,
	requireOrgRepoById,
} from "#/lib/server/org-guard";

export interface OrgResponseDefaultsView {
	defaults: OrgResponseDefaults;
	usage: RedactionUsage;
}

type SaveResult = { ok: true } | { error: string };

const INVALID_SETTINGS =
	"These settings are not valid. Check the values and save again.";

const STALE_GIF = Symbol("stale-gif");
const STALE_GIF_ERROR =
	"That GIF is no longer available. Pick it again and save.";

function savedGifs(config: ResponseConfig): Map<string, CloseGif> {
	const gifs = [
		config.closeComment.gif,
		...(config.blocks.close ?? []).map((block) =>
			block.type === "gif" ? block.gif : null,
		),
	].filter((gif): gif is CloseGif => gif !== null);
	return new Map(gifs.map((gif) => [gif.id, gif]));
}

async function settledGif(
	next: CloseGif | null,
	saved: Map<string, CloseGif>,
): Promise<CloseGif | null | typeof STALE_GIF> {
	if (!next) {
		return null;
	}
	const known = saved.get(next.id);
	if (known) {
		return known;
	}
	const { resolveServedGif } = await import("#/lib/server/giphy-store");
	return (await resolveServedGif(next.id)) ?? STALE_GIF;
}

async function settledCloseBlocks(
	blocks: ResponseBlock[] | undefined,
	saved: Map<string, CloseGif>,
): Promise<ResponseBlock[] | undefined | typeof STALE_GIF> {
	if (!blocks) {
		return undefined;
	}
	const settled: ResponseBlock[] = [];
	for (const block of blocks) {
		if (block.type !== "gif") {
			settled.push(block);
			continue;
		}
		const gif = await settledGif(block.gif, saved);
		if (gif === STALE_GIF) {
			return STALE_GIF;
		}
		settled.push({ ...block, gif });
	}
	return settled;
}

function samePolicy(a: RedactionPolicy, b: RedactionPolicy): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

export const getRepoResponseConfig = createServerFn({ method: "GET" })
	.middleware([
		accessGuardMiddleware,
		orgPermissionMiddleware("responses:read"),
	])
	.inputValidator((input: { org: string; repoId: string }) => input)
	.handler(async ({ data, context }): Promise<ResponseConfig> => {
		await requireOrgRepoById((context as OrgContext).org.id, data.repoId);
		const { repoServices } = await import("@tripwire/db");
		const { getDb } = await import("#/lib/server/db");
		return repoServices.getResponseConfig(getDb().db, data.repoId);
	});

export const saveRepoResponseConfig = createServerFn({ method: "POST" })
	.middleware([
		accessGuardMiddleware,
		orgPermissionMiddleware("responses:manage"),
	])
	.inputValidator(
		(input: { org: string; repoId: string; config: unknown }) => input,
	)
	.handler(async ({ data, context }): Promise<SaveResult> => {
		await requireOrgRepoById((context as OrgContext).org.id, data.repoId);
		const parsed = responseConfigSchema.safeParse(data.config);
		if (!parsed.success) {
			return { error: parsed.error.issues[0]?.message ?? INVALID_SETTINGS };
		}
		const { repoServices, responseServices } = await import("@tripwire/db");
		const { getDb } = await import("#/lib/server/db");
		const db = getDb().db;
		const saved = await repoServices.getResponseConfig(db, data.repoId);
		const known = savedGifs(saved);
		const gif = await settledGif(parsed.data.closeComment.gif, known);
		const close = await settledCloseBlocks(parsed.data.blocks.close, known);
		if (gif === STALE_GIF || close === STALE_GIF) {
			return { error: STALE_GIF_ERROR };
		}
		const config: ResponseConfig = {
			...parsed.data,
			closeComment: { ...parsed.data.closeComment, gif },
			blocks: { ...parsed.data.blocks, close },
		};
		const before = await responseServices.getRedactionPolicy(db, data.repoId);
		await repoServices.upsertResponseConfig(db, data.repoId, config);
		const after = await responseServices.getRedactionPolicy(db, data.repoId);
		if (!samePolicy(before, after)) {
			const { enqueueSurfaceRefresh } = await import(
				"#/lib/server/refresh-surfaces"
			);
			await enqueueSurfaceRefresh([data.repoId]);
		}
		return { ok: true };
	});

export const getOrgResponseDefaults = createServerFn({ method: "GET" })
	.middleware([
		accessGuardMiddleware,
		orgPermissionMiddleware("responses:read"),
	])
	.inputValidator((input: { org: string }) => input)
	.handler(async ({ context }): Promise<OrgResponseDefaultsView> => {
		const orgId = (context as OrgContext).org.id;
		const { responseServices } = await import("@tripwire/db");
		const { getDb } = await import("#/lib/server/db");
		const db = getDb().db;
		const [defaults, usage] = await Promise.all([
			responseServices.getOrgResponseDefaults(db, orgId),
			responseServices.getOrgRedactionUsage(db, orgId),
		]);
		return { defaults, usage };
	});

export const saveOrgResponseDefaults = createServerFn({ method: "POST" })
	.middleware([
		accessGuardMiddleware,
		orgPermissionMiddleware("responses:manage"),
	])
	.inputValidator((input: { org: string; defaults: unknown }) => input)
	.handler(async ({ data, context }): Promise<SaveResult> => {
		const orgId = (context as OrgContext).org.id;
		const parsed = orgResponseDefaultsSchema.safeParse(data.defaults);
		if (!parsed.success) {
			return { error: parsed.error.issues[0]?.message ?? INVALID_SETTINGS };
		}
		const { responseServices } = await import("@tripwire/db");
		const { getDb } = await import("#/lib/server/db");
		const db = getDb().db;
		const before = await responseServices.getOrgResponseDefaults(db, orgId);
		await responseServices.upsertOrgResponseDefaults(db, orgId, parsed.data);
		if (!samePolicy(before.redaction, parsed.data.redaction)) {
			const { enqueueSurfaceRefresh } = await import(
				"#/lib/server/refresh-surfaces"
			);
			await enqueueSurfaceRefresh(
				await responseServices.listInheritingRepoIds(db, orgId),
			);
		}
		return { ok: true };
	});

export const searchCloseGifs = createServerFn({ method: "GET" })
	.middleware([
		accessGuardMiddleware,
		orgPermissionMiddleware("responses:manage"),
	])
	.inputValidator((input: { org: string; query: string; offset: number }) => ({
		org: String(input.org),
		query: String(input.query ?? "").slice(0, 200),
		offset: Number(input.offset) || 0,
	}))
	.handler(async ({ data }): Promise<GiphyPage> => {
		const { readSessionState } = await import("#/lib/server/session");
		const { giphyDeps } = await import("#/lib/server/giphy-store");
		const { searchGiphy } = await import("#/lib/server/giphy-search");
		const session = await readSessionState();
		return searchGiphy(await giphyDeps(), {
			userId: session.userId ?? "open",
			query: data.query,
			offset: data.offset,
		});
	});
