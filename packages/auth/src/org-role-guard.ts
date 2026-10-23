import {
	orgRoleCreateBodySchema,
	orgRoleUpdateBodySchema,
} from "@tripwire/contracts";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";

const GUARDED_BODIES = {
	"/organization/create-role": orgRoleCreateBodySchema,
	"/organization/update-role": orgRoleUpdateBodySchema,
} as const;

function isGuardedPath(path: string): path is keyof typeof GUARDED_BODIES {
	return Object.hasOwn(GUARDED_BODIES, path);
}

export function orgRoleGuard(): BetterAuthPlugin {
	return {
		id: "tripwire-org-role-guard",
		hooks: {
			before: [
				{
					matcher: (context) => isGuardedPath(context.path ?? ""),
					handler: createAuthMiddleware(async (ctx) => {
						const path = ctx.path;
						if (!isGuardedPath(path)) {
							return;
						}
						const parsed = GUARDED_BODIES[path].safeParse(ctx.body);
						if (!parsed.success) {
							throw new APIError("BAD_REQUEST", {
								message:
									parsed.error.issues[0]?.message ?? "invalid role request",
							});
						}
					}),
				},
			],
		},
	};
}
