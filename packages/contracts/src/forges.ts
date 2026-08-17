import { z } from "zod";

/**
 * THE forge list. Every forge-shaped thing in the product derives from this one
 * array — the persisted `forge` enum, better-auth's trusted providers, the login
 * grid, the connect dialog, the brand marks. Adding a forge is editing this
 * array; nothing else is a list of forges.
 *
 * `status` is the whole trick:
 * - `live`     — an adapter exists, so it can be signed into, connected, and
 *                stored on a row. These and only these widen `Forge`.
 * - `planned`  — announced in the UI, not built. It renders in every forge grid
 *                as an inert cell, and CANNOT reach the database, because
 *                `forgeSchema` never sees it.
 *
 * Flipping a `planned` entry to `live` widens `Forge`, which breaks every
 * exhaustive `Record<Forge, …>` in the app until the new arm exists. That
 * compile error is the checklist — don't route around it.
 *
 * Array ORDER is display order: the login and connect grids lay this out 2×2 in
 * exactly this sequence, so live and planned alternate rather than clustering
 * into a dead column.
 */
export type ForgeStatus = "live" | "planned";

export interface ForgeCatalogEntry {
	readonly id: string;
	/** Brand casing, shown verbatim in the grids — not a slug. */
	readonly label: string;
	readonly status: ForgeStatus;
}

export const FORGE_CATALOG = [
	{ id: "github", label: "GitHub", status: "live" },
	{ id: "opengit", label: "OpenGit", status: "planned" },
	{ id: "gitlab", label: "GitLab", status: "planned" },
	{ id: "origin", label: "ORIGIN", status: "planned" },
] as const satisfies readonly ForgeCatalogEntry[];

type CatalogEntry = (typeof FORGE_CATALOG)[number];
type LiveEntry = Extract<CatalogEntry, { status: "live" }>;

/** Every forge the UI advertises, built or not — the grids iterate this. */
export type ForgeId = CatalogEntry["id"];

/**
 * The forges Tripwire can actually ingest. A discriminant carried on every event
 * and stored on the row — NOT a routing dimension (see architecture: one app
 * shell, per-forge adapters + webhook entrypoints). A strict subset of
 * `ForgeId`: a `planned` forge has no adapter, so it can never reach a row.
 */
export type Forge = LiveEntry["id"];

function isLive(entry: CatalogEntry): entry is LiveEntry {
	return entry.status === "live";
}

/**
 * Cast because `z.enum` wants a non-empty tuple and `filter` can only prove an
 * array. The ELEMENT type is honest — `isLive` narrows it to `Forge` — so the
 * only thing asserted here is non-emptiness, which the catalog literal above
 * satisfies by inspection.
 */
export const forgeSchema = z.enum(
	FORGE_CATALOG.filter(isLive).map((entry) => entry.id) as [Forge, ...Forge[]],
);

/** Brand labels by status — so UI copy that names forges ("github and gitlab
 * today") is generated from the catalog instead of drifting out of sync. */
export const LIVE_FORGE_LABELS: readonly string[] = FORGE_CATALOG.filter(
	isLive,
).map((entry) => entry.label);

export const PLANNED_FORGE_LABELS: readonly string[] = FORGE_CATALOG.filter(
	(entry) => entry.status === "planned",
).map((entry) => entry.label);

/** Catalog lookup by id, for surfaces that hold an id and need its label. */
export const FORGE_BY_ID = Object.fromEntries(
	FORGE_CATALOG.map((entry) => [entry.id, entry]),
) as Record<ForgeId, CatalogEntry>;
