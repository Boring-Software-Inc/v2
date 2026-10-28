import { z } from "zod";

/**
 * Forge storage and capability catalog. `live` admits storage and ingest;
 * `connection` admits verified connections and storage only; `planned` admits neither.
 * Display order follows this array. Runtime registries remain exhaustive and
 * explicitly return null for connection-only forges.
 */
export type ForgeStatus = "live" | "connection" | "planned";

/**
 * How a forge authenticates, or absent when you cannot sign in with it yet.
 *
 *   social — a first-class better-auth provider (`signIn.social`)
 *   oauth2 — the genericOAuth plugin, for anything better-auth has no built-in
 *            provider for (`signIn.oauth2`)
 */
export type ForgeSignIn = "social" | "oauth2";

export interface ForgeCatalogEntry {
	readonly id: string;
	/** Brand casing, shown verbatim in the grids — not a slug. */
	readonly label: string;
	readonly status: ForgeStatus;
	/** Sign-in availability is registered independently of repository capabilities. */
	readonly signIn?: ForgeSignIn;
	readonly reviews?: boolean;
	readonly paused?: boolean;
}

export const FORGE_CATALOG = [
	{
		id: "github",
		label: "GitHub",
		status: "live",
		signIn: "social",
		reviews: true,
	},
	// Paused: open-git's installation webhook names no installer, so Tripwire
	// cannot prove who may claim an install. Ingest for repos already connected
	// continues; sign-in and new connections are off.
	{ id: "opengit", label: "OpenGit", status: "live", paused: true },
	{ id: "gitlab", label: "GitLab", status: "planned" },
	{ id: "gitcafe", label: "GitCafe", status: "connection", signIn: "social" },
] as const satisfies readonly ForgeCatalogEntry[];

type CatalogEntry = (typeof FORGE_CATALOG)[number];
type LiveEntry = Extract<CatalogEntry, { status: "live" }>;
type StoredEntry = Extract<CatalogEntry, { status: "live" | "connection" }>;

/** Every forge the UI advertises, built or not. The grids iterate this. */
export type ForgeId = CatalogEntry["id"];

export const forgeIdSchema = z.enum(
	FORGE_CATALOG.map((entry) => entry.id) as [ForgeId, ...ForgeId[]],
);

/** Forge-qualified identities admitted to persisted repository rows. */
export type Forge = StoredEntry["id"];
export type IngestForge = LiveEntry["id"];

function isLive(entry: CatalogEntry): entry is LiveEntry {
	return entry.status === "live";
}

/** Only the tuple non-emptiness is asserted; the catalog determines its members. */
export const forgeSchema = z.enum(
	FORGE_CATALOG.filter((entry) => entry.status !== "planned").map(
		(entry) => entry.id,
	) as [Forge, ...Forge[]],
);

export const ingestForgeSchema = z.enum(
	FORGE_CATALOG.filter(isLive).map((entry) => entry.id) as [
		IngestForge,
		...IngestForge[],
	],
);

export function forgeEvaluates(id: ForgeId): boolean {
	return FORGE_BY_ID[id].status === "live";
}

/** Brand labels by status — so UI copy that names forges ("github and gitlab
 * today") is generated from the catalog instead of drifting out of sync. */
export const LIVE_FORGE_LABELS: readonly string[] = FORGE_CATALOG.filter(
	(entry) => isLive(entry) && !("paused" in entry),
).map((entry) => entry.label);

/**
 * Forges with sign-in support, adapter or not. Deployment availability also
 * requires server registration. Auth applies its own account-linking policy;
 * GitCafe must never become trusted for same-email linking.
 */
export const SIGN_IN_FORGE_IDS: readonly ForgeId[] = FORGE_CATALOG.filter(
	// `in`, not a property read: the catalog is `as const`, so entries without a
	// sign-in do not carry the key at all and the union has no such property.
	(entry) => "signIn" in entry,
).map((entry) => entry.id);

/** Public auth availability contains only provider IDs, never configuration. */
export const configuredSignInProviderIdsSchema = z.array(forgeIdSchema);
export type ConfiguredSignInProviderIds = z.infer<
	typeof configuredSignInProviderIdsSchema
>;

export const providerAvailabilitySchema = z.strictObject({
	available: configuredSignInProviderIdsSchema,
});
export type ProviderAvailability = z.infer<typeof providerAvailabilitySchema>;

/** How to sign in with a forge, or null when it offers no sign-in. */
export function forgeSignIn(id: ForgeId): ForgeSignIn | null {
	const entry = FORGE_BY_ID[id];
	return entry && "signIn" in entry ? entry.signIn : null;
}

export function forgeConnectable(id: ForgeId): boolean {
	const entry = FORGE_BY_ID[id];
	return (
		entry !== undefined && entry.status !== "planned" && !("paused" in entry)
	);
}

export function forgePostsReviews(id: ForgeId): boolean {
	const entry = FORGE_BY_ID[id];
	return entry !== undefined && "reviews" in entry && entry.reviews;
}

/** Catalog lookup by id, for surfaces that hold an id and need its label. */
export const FORGE_BY_ID = Object.fromEntries(
	FORGE_CATALOG.map((entry) => [entry.id, entry]),
) as Record<ForgeId, CatalogEntry>;

/**
 * The web url of a change request on its forge.
 *
 * The path differs per forge (`/pull/` on github, `/pulls/` on open-git), so it
 * lives here rather than being rebuilt at each call site. `origin` is passed in
 * because a self-hosted instance moves: contracts reads no environment.
 *
 * Returns null when there is no change request to point at.
 */
export function changeRequestUrl(input: {
	forge: ForgeId;
	repoFullName: string;
	number: number | null;
	/** No trailing slash. Defaults to the forge's public host. */
	origin?: string;
}): string | null {
	if (input.number === null) {
		return null;
	}
	const base = (input.origin ?? DEFAULT_FORGE_ORIGIN[input.forge]).replace(
		/\/$/,
		"",
	);
	const segment = input.forge === "github" ? "pull" : "pulls";
	return `${base}/${input.repoFullName}/${segment}/${input.number}`;
}

/**
 * Public host per forge. A self-hosted deployment overrides this by passing an
 * origin; a planned forge still needs an entry so the Record stays exhaustive.
 */
export const DEFAULT_FORGE_ORIGIN = {
	github: "https://github.com",
	opengit: "https://open-git.com",
	gitlab: "https://gitlab.com",
	gitcafe: "https://git.cafe",
} satisfies Record<ForgeId, string>;
