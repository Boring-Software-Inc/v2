/** Feature-flag keys we evaluate. */
export const FLAGS = {
	/** Closed-beta access gate. On → pending/rejected users are blocked. */
	accessGate: "access-gate",
	showSidebar: "show-sidebar",
	sharedSpamBlocklist: "shared-spam-blocklist",
} as const;
