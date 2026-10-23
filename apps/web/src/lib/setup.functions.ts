import { createServerFn } from "@tanstack/react-start";
import type { SetupRunView } from "@tripwire/contracts";
import type { AgentSetupPromptState, OrgWithRole } from "@tripwire/db";

export type { AgentSetupPromptState };

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

const HIDDEN_PROMPT: AgentSetupPromptState = {
	visible: false,
	reminder: false,
	dismissCount: 0,
};

export const getAgentSetupPrompt = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware, orgAdminMiddleware])
	.inputValidator((input: { org: string }) => input)
	.handler(async ({ context }): Promise<AgentSetupPromptState> => {
		const org = (context as { org: OrgWithRole }).org;
		const { requireSession } = await import("#/lib/server/session");
		const userId = await requireSession();
		if (!userId) {
			return HIDDEN_PROMPT;
		}
		const { getDb } = await import("#/lib/server/db");
		const { setupServices } = await import("@tripwire/db");
		return setupServices.getAgentSetupPrompt(getDb().db, {
			orgId: org.id,
			userId,
		});
	});

export const dismissAgentSetupPrompt = createServerFn({ method: "POST" })
	.middleware([accessGuardMiddleware, orgAdminMiddleware])
	.inputValidator((input: { org: string }) => input)
	.handler(async ({ context }): Promise<{ dismissCount: number }> => {
		const org = (context as { org: OrgWithRole }).org;
		const { requireSession } = await import("#/lib/server/session");
		const userId = await requireSession();
		if (!userId) {
			throw new Error("Your session ended. Sign in again to continue.");
		}
		const { getDb } = await import("#/lib/server/db");
		const { setupServices } = await import("@tripwire/db");
		return setupServices.dismissAgentSetupPrompt(getDb().db, {
			orgId: org.id,
			userId,
		});
	});
