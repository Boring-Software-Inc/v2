import { createServerFn } from "@tanstack/react-start";
import type { SetupRunView } from "@tripwire/contracts";
import type { OrgWithRole } from "@tripwire/db";
import { accessGuardMiddleware } from "#/lib/server/gated-server-fn";
import { orgAdminMiddleware } from "#/lib/server/org-guard";

export type SetupRunState =
	| { status: "ready"; run: SetupRunView }
	| { status: "unavailable" };

export const ensureSetupRun = createServerFn({ method: "POST" })
	.middleware([accessGuardMiddleware, orgAdminMiddleware])
	.inputValidator((input: { org: string }) => input)
	.handler(async ({ context }): Promise<SetupRunState> => {
		const org = (context as { org: OrgWithRole }).org;
		const { requireSession } = await import("#/lib/server/session");
		const userId = await requireSession();
		if (!userId) {
			return { status: "unavailable" };
		}
		const { getDb } = await import("#/lib/server/db");
		const { setupServices } = await import("@tripwire/db");
		const run = await setupServices.ensureSetupRun(getDb().db, {
			orgId: org.id,
			userId,
		});
		return { status: "ready", run };
	});

export const findSetupRun = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware, orgAdminMiddleware])
	.inputValidator((input: { org: string }) => input)
	.handler(async ({ context }): Promise<SetupRunState> => {
		const org = (context as { org: OrgWithRole }).org;
		const { requireSession } = await import("#/lib/server/session");
		const userId = await requireSession();
		if (!userId) {
			return { status: "unavailable" };
		}
		const { getDb } = await import("#/lib/server/db");
		const { setupServices } = await import("@tripwire/db");
		const run = await setupServices.findActiveSetupRun(getDb().db, {
			orgId: org.id,
			userId,
		});
		return run ? { status: "ready", run } : { status: "unavailable" };
	});
