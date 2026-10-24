import type { FlagEvaluator } from "@tripwire/auth/flag-evaluation";
import { DATABUDDY_WEBSITE_ID } from "@tripwire/contracts";
import type { SessionGuardState } from "@tripwire/db";
import { createDatabuddyApi, type DatabuddyApi } from "@tripwire/utils";

let api: DatabuddyApi | null | undefined;
let evaluator: FlagEvaluator | undefined;

export function getDatabuddyApi(): DatabuddyApi | null {
	if (api !== undefined) {
		return api;
	}
	const apiKey = process.env.DATABUDDY_API_KEY;
	api = apiKey
		? createDatabuddyApi({
				apiKey,
				websiteId: DATABUDDY_WEBSITE_ID,
				baseUrl: process.env.DATABUDDY_API_URL,
			})
		: null;
	return api;
}

export async function getFlagEvaluator(): Promise<FlagEvaluator> {
	if (evaluator) {
		return evaluator;
	}
	const { createFlagEvaluator } = await import(
		"@tripwire/auth/flag-evaluation"
	);
	evaluator = createFlagEvaluator({ apiUrl: process.env.DATABUDDY_API_URL });
	return evaluator;
}

export async function enqueueFlagSync(flagKey: string): Promise<void> {
	const { getBoss, getDb, isDemoMode } = await import("#/lib/server/db");
	if (isDemoMode()) {
		const { flagOverrideServices } = await import("@tripwire/db");
		const client = getDatabuddyApi();
		if (!client) {
			return;
		}
		await flagOverrideServices.syncFlagOverrides(getDb().db, client, flagKey);
		return;
	}
	const { SYNC_FLAG_OVERRIDES_QUEUE, syncFlagOverridesOptions } = await import(
		"@tripwire/db"
	);
	const boss = await getBoss();
	await boss.send(
		SYNC_FLAG_OVERRIDES_QUEUE,
		{ flagKey },
		syncFlagOverridesOptions(flagKey),
	);
}

export async function currentSession() {
	const { getAuth } = await import("#/lib/server/auth");
	const auth = getAuth();
	if (!auth) {
		return null;
	}
	const { getStartContext } = await import("@tanstack/start-storage-context");
	const headers = getStartContext().request.headers;
	const session = await auth.api.getSession({ headers });
	return session ? { auth, headers, session } : null;
}

export const IMPERSONATING_MESSAGE =
	"You are viewing as someone else. Stop impersonating to change this.";

export const SESSION_ENDED_MESSAGE =
	"Your session ended. Sign in again to continue.";

export async function fenceOf(current: {
	user: { id: string };
	session: { id: string; impersonatedBy?: string | null };
}): Promise<SessionGuardState> {
	const { getDb } = await import("#/lib/server/db");
	const { sessionFence } = await import("@tripwire/auth/staff-impersonation");
	return await sessionFence(getDb().db, current);
}

export async function assertNotImpersonating(): Promise<void> {
	const current = await currentSession();
	if (!current) {
		return;
	}
	const fence = await fenceOf(current.session);
	if (!fence.live) {
		throw new Error(SESSION_ENDED_MESSAGE);
	}
	if (fence.impersonatedBy) {
		throw new Error(IMPERSONATING_MESSAGE);
	}
}
