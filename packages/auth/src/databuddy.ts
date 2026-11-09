/** Feature-flag keys we evaluate. */
export const FLAGS = {
	/** Closed-beta access gate. On → pending/rejected users are blocked. */
	accessGate: "access-gate",
	sharedSpamBlocklist: "shared-spam-blocklist",
} as const;
