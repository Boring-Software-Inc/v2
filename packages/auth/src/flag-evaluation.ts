import { createServerFlagsManager } from "@databuddy/sdk/node";
import { type FlagSource, flagSourceFromReason } from "@tripwire/contracts";
import { DATABUDDY_CLIENT_ID } from "./databuddy.ts";

export interface EvaluatedFlag {
	key: string;
	enabled: boolean;
	source: FlagSource;
	reason: string | null;
}

export type FlagEvaluator = (
	keys: readonly string[],
	user: { userId: string; email?: string },
) => Promise<EvaluatedFlag[]>;

export function createFlagEvaluator(
	input: { apiUrl?: string } = {},
): FlagEvaluator {
	const manager = createServerFlagsManager({
		clientId: DATABUDDY_CLIENT_ID,
		apiUrl: input.apiUrl,
		cacheTtl: 5_000,
	});
	return async (keys, user) =>
		await Promise.all(
			keys.map(async (key) => {
				try {
					const result = await manager.getFlag(key, user);
					return {
						key,
						enabled: result.enabled,
						source: flagSourceFromReason(result.reason),
						reason: result.reason,
					};
				} catch {
					return {
						key,
						enabled: false,
						source: "unknown" as const,
						reason: null,
					};
				}
			}),
		);
}
