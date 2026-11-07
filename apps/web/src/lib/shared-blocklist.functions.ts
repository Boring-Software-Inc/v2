import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import {
	SHARED_BLOCKLIST_RULE_ID,
	sharedBlocklistAvailable,
} from "@tripwire/contracts";
import { z } from "zod";
import { accessGuardMiddleware } from "#/lib/server/gated-server-fn";
import {
	orgPermissionMiddleware,
	resolveOrgRepo,
} from "#/lib/server/org-guard";

const repoInput = z.object({ org: z.string().min(1), repo: z.string().min(1) });

async function pilotRepo(orgId: string, name: string) {
	const allowed = process.env.TRIPWIRE_SHARED_BLOCKLIST_PILOT_REPOSITORY_ID;
	if (!allowed) return null;
	const { getDb } = await import("#/lib/server/db");
	const { repoServices } = await import("@tripwire/db");
	const db = getDb().db;
	const { getAuth } = await import("#/lib/server/auth");
	const auth = getAuth();
	if (auth) {
		const { getStartContext } = await import("@tanstack/start-storage-context");
		const session = await auth.api.getSession({
			headers: getStartContext().request.headers,
		});
		if (!session) return null;
		const { FLAGS } = await import("@tripwire/auth/databuddy");
		const { getFlagEvaluator } = await import("#/lib/server/staff-users");
		const evaluate = await getFlagEvaluator();
		const flags = await evaluate([FLAGS.sharedSpamBlocklist], {
			userId: session.user.id,
			email: session.user.email,
		});
		if (
			!flags.some(
				(flag) => flag.key === FLAGS.sharedSpamBlocklist && flag.enabled,
			)
		)
			return null;
	}
	const scoped = await resolveOrgRepo(orgId, name);
	const repo = await repoServices.getRepoById(db, scoped.id);
	if (!repo?.armed || !sharedBlocklistAvailable(allowed, repo)) return null;
	return { db, repoServices, id: repo.id };
}

export const getSharedBlocklistPilot = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware, orgPermissionMiddleware("rules:manage")])
	.inputValidator(repoInput)
	.handler(async ({ data, context }) => {
		const pilot = await pilotRepo(context.org.id, data.repo);
		if (!pilot) return null;
		const configs = await pilot.repoServices.listRuleConfigs(
			pilot.db,
			pilot.id,
		);
		return {
			enabled: configs.some(
				(rule) => rule.ruleId === SHARED_BLOCKLIST_RULE_ID && rule.enabled,
			),
		};
	});

export const setSharedBlocklistPilot = createServerFn({ method: "POST" })
	.middleware([accessGuardMiddleware, orgPermissionMiddleware("rules:manage")])
	.inputValidator(repoInput.extend({ enabled: z.boolean() }))
	.handler(async ({ data, context }) => {
		const pilot = await pilotRepo(context.org.id, data.repo);
		if (!pilot) throw notFound();
		await pilot.repoServices.upsertRuleConfig(pilot.db, pilot.id, {
			ruleId: SHARED_BLOCKLIST_RULE_ID,
			version: 1,
			enabled: data.enabled,
			config: {},
		});
		return { enabled: data.enabled };
	});
