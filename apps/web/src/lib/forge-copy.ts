import { LIVE_FORGE_LABELS, PLANNED_FORGE_LABELS } from "@tripwire/contracts";

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
