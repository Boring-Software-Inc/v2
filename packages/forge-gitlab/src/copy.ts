import { COMMENT_MARKER } from "@tripwire/contracts";

/**
 * Copy that is local to the GitLab adapter. Adapters are siblings and never
 * import each other, so this repeats the small helper the GitHub adapter keeps.
 */

/**
 * Turn the active comment into a superseded one. Remove the marker so the
 * comment is no longer the active result, then add a short note. The next
 * `upsertComment` will not match this body when it looks for the marker.
 */
export function supersededBody(previous: string): string {
	return `${previous.replace(COMMENT_MARKER, "")}\n\n> _Superseded by a newer Tripwire result._`;
}
