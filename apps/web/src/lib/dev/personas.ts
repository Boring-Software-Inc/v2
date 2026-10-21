/**
 * DEV persona switcher (§13) — Tripwire's SIX real product states, not SaaS
 * tiers. This module is client-safe metadata ONLY (no server imports); the
 * switcher UI renders it and the dev endpoint (`/api/dev/*`) maps ids to
 * auto-created fixtures. Gated everywhere by `import.meta.env.DEV`.
 */

export type PersonaId =
	| "fresh"
	| "one-repo"
	| "many-repos"
	| "empty"
	| "active"
	| "anonymous";

export interface Persona {
	id: PersonaId;
	label: string;
	/** One terse line, constitution voice. */
	description: string;
	/**
	 * Where a successful switch lands. `anonymous` is overridden by the server
	 * (it returns the seeded public run's path after signing out).
	 */
	landing: string;
}

export const PERSONAS: Persona[] = [
	{
		id: "fresh",
		label: "fresh maintainer",
		description:
			"Signed in with no installation. Shows the install prompt on the org home.",
		landing: "/",
	},
	{
		id: "one-repo",
		label: "one repo",
		description: "One granted repo. Shows the org home with a single row.",
		landing: "/",
	},
	{
		id: "many-repos",
		label: "many repos",
		description: "Several granted repos. Shows the org home as a list.",
		landing: "/",
	},
	{
		id: "empty",
		label: "empty dashboard",
		description: "Installed with no events. Shows every empty state at once.",
		landing: "/",
	},
	{
		id: "active",
		label: "active dashboard",
		description: "A pending review and recent runs. Shows the product in use.",
		landing: "/",
	},
	{
		id: "anonymous",
		label: "anonymous",
		description: "Signs out and opens a public run as a stranger.",
		landing: "/",
	},
];

/** Auto-login lands here when there's no session — the populated dashboard. */
export const DEFAULT_PERSONA: PersonaId = "active";

export function getPersona(id: string): Persona | undefined {
	return PERSONAS.find((p) => p.id === id);
}
