/**
 * @tripwire/contracts — the shared language.
 *
 * Zod schemas + inferred types, extracted from the redesign demo's mock data.
 * The demo's shapes are the contract; the backend's job is to satisfy them.
 * No functions, no I/O, no deps except zod.
 *
 * Files follow the spec §4 ontology (runs, rules, contributor, repo, insights,
 * moderation). The remaining §4 contracts (events, review, workflow, check)
 * land with the build steps that produce their shapes — see DECISIONS.md.
 */

export * from "./activity.ts";
export * from "./check.ts";
export * from "./contributor.ts";
export * from "./events.ts";
export * from "./insights.ts";
export * from "./moderation.ts";
export * from "./repo.ts";
export * from "./repo-content.ts";
export * from "./review.ts";
export * from "./rules.ts";
export * from "./runs.ts";
export * from "./workflow.ts";
