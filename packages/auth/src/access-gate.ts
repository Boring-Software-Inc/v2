import { createServerFlagsManager } from "@databuddy/sdk/node";
import type { Db } from "@tripwire/db";
import { schema } from "@tripwire/db";
import { getDatabuddyWebsiteId } from "@tripwire/utils/databuddy-server";
import { eq } from "drizzle-orm";
import { type AccessDenial, accessDenialFor, gateFromFlag } from "./access.ts";
import { FLAGS } from "./databuddy.ts";

/**
 * Server-side closed-beta gate evaluation. **Server-only** — imports
 * `@databuddy/sdk/node`; never pull this into a client bundle. Shared by the
 * web server functions (route gate) and the Hono SSE endpoint (API boundary).
 *
 * Databuddy's `access-gate` flag is the primary control (toggle from the
 * dashboard, no redeploy). If Databuddy is unreachable or the flag doesn't
 * exist yet, we fall back to the `ACCESS_GATE_ENABLED` env kill-switch so the
 * security boundary never hard-depends on an external service.
 */
const flags = createServerFlagsManager({ clientId: getDatabuddyWebsiteId() });

const GATE_CACHE_TTL_MS = 60_000;
const GATE_CACHE_MAX_ENTRIES = 10_000;
const gateCache = new Map<string, { value: boolean; expiresAt: number }>();

function isTruthy(value: string | undefined): boolean {
	return value === "true" || value === "1";
}

export async function isAccessGateEnabled(user?: {
	userId?: string;
	email?: string;
}): Promise<boolean> {
	const cacheKey = user?.userId ?? user?.email ?? "anonymous";
	const cached = gateCache.get(cacheKey);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.value;
	}
	const envFallback = isTruthy(process.env.ACCESS_GATE_ENABLED);
	let value: boolean;
	try {
		const flag = await flags.getFlag(FLAGS.accessGate, user);
		value = gateFromFlag(flag, envFallback);
	} catch {
		value = gateFromFlag(null, envFallback);
	}
	if (gateCache.size >= GATE_CACHE_MAX_ENTRIES) {
		gateCache.clear();
	}
	gateCache.set(cacheKey, { value, expiresAt: Date.now() + GATE_CACHE_TTL_MS });
	return value;
}

/**
 * The actual server boundary: returns a FORBIDDEN denial when the gate is on
 * and the user isn't approved, else `null`. Reads the status fresh from the DB
 * so a promotion takes effect on the next request without re-auth. Callers turn
 * the denial into their own HTTP response (401/403).
 */
export async function assertApproved(
	db: Db,
	userId: string,
	email?: string,
): Promise<AccessDenial | null> {
	if (!(await isAccessGateEnabled({ userId, email }))) {
		return null;
	}
	const rows = await db
		.select({ accessStatus: schema.user.accessStatus })
		.from(schema.user)
		.where(eq(schema.user.id, userId))
		.limit(1);
	return accessDenialFor(rows[0]?.accessStatus ?? "pending");
}
