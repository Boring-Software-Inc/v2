import {
	FORGE_BY_ID,
	LIVE_FORGE_LABELS,
	PLANNED_FORGE_LABELS,
	SIGN_IN_FORGE_IDS,
} from "@tripwire/contracts";

/**
 * Prose that names forges, generated from the catalog. Any sentence listing
 * which forges work ("tripwire watches GitHub and GitLab today") goes through
 * here — hand-typing the list is how a shipped adapter ends up still described
 * as coming soon.
 */
const LIST = new Intl.ListFormat("en", { style: "long", type: "conjunction" });

/** e.g. "GitHub and GitLab" */
export const LIVE_FORGES = LIST.format(LIVE_FORGE_LABELS);

/** e.g. "OpenGit and ORIGIN" */
export const PLANNED_FORGES = LIST.format(PLANNED_FORGE_LABELS);

/** e.g. "GitHub and OpenGit" — forges you can authenticate with, which is a
 * different set from the ones that can own a repo. */
export const SIGN_IN_FORGES = LIST.format(
	SIGN_IN_FORGE_IDS.map((id) => FORGE_BY_ID[id].label),
);
