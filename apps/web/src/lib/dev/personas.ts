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
		description: "signed in, no installation — lands on onboarding.",
		landing: "/onboarding",
	},
	{
		id: "one-repo",
		label: "one repo",
		description: "one granted repo, auto-selected — straight to the dashboard.",
		landing: "/onboarding",
	},
	{
		id: "many-repos",
		label: "many repos",
		description: "several granted repos — the picker path.",
		landing: "/onboarding",
	},
	{
		id: "empty",
		label: "empty dashboard",
		description: "installed, zero events — every empty state at once.",
		landing: "/",
	},
	{
		id: "active",
		label: "active dashboard",
		description: "a pending review + recent runs — the product with a story.",
		landing: "/",
	},
	{
		id: "anonymous",
		label: "anonymous",
		description: "signs out and opens a public run as a stranger.",
		landing: "/",
	},
];

/** Auto-login lands here when there's no session — the populated dashboard. */
export const DEFAULT_PERSONA: PersonaId = "active";

export function getPersona(id: string): Persona | undefined {
	return PERSONAS.find((p) => p.id === id);
}
