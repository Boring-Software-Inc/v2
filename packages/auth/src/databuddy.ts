import { DATABUDDY_WEBSITE_ID } from "@tripwire/contracts";

/**
 * Public Databuddy project client id — safe to ship to the browser. Shared by
 * the analytics `<Databuddy>` component (apps/web) and the server flags manager
 * (`access-gate.ts`) so both evaluate against the same project. Client-safe:
 * this file imports no SDK, only constants.
 */
export const DATABUDDY_CLIENT_ID = DATABUDDY_WEBSITE_ID;

/** Feature-flag keys we evaluate. */
export const FLAGS = {
	/** Closed-beta access gate. On → pending/rejected users are blocked. */
	accessGate: "access-gate",
	showSidebar: "show-sidebar",
} as const;
