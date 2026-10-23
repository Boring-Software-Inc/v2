import { createServerFn } from "@tanstack/react-start";
import { scheduleTimezoneSchema } from "@tripwire/contracts";
import type { OrgWithRole } from "@tripwire/db";
import { accessGuardMiddleware } from "#/lib/server/gated-server-fn";
import { orgPermissionMiddleware } from "#/lib/server/org-guard";

const timezoneChoiceSchema = scheduleTimezoneSchema.nullable();

export const setAccountTimezone = createServerFn({ method: "POST" })
	.middleware([accessGuardMiddleware])
	.inputValidator((input: { timezone: string | null }) => ({
		timezone: timezoneChoiceSchema.parse(input.timezone),
	}))
	.handler(async ({ data }): Promise<{ timezone: string | null }> => {
		const { requireSession } = await import("#/lib/server/session");
		const userId = await requireSession();
		if (!userId) {
			throw new Error("Your session ended. Sign in again to continue.");
		}
		const { getDb } = await import("#/lib/server/db");
		const { accountServices } = await import("@tripwire/db");
		await accountServices.setUserTimezone(getDb().db, {
			userId,
			timezone: data.timezone,
		});
		return { timezone: data.timezone };
	});

export const setOrgTimezone = createServerFn({ method: "POST" })
	.middleware([
		accessGuardMiddleware,
		orgPermissionMiddleware("settings:manage"),
	])
	.inputValidator((input: { org: string; timezone: string | null }) => ({
		org: input.org,
		timezone: timezoneChoiceSchema.parse(input.timezone),
	}))
	.handler(async ({ data, context }): Promise<{ timezone: string | null }> => {
		const org = (context as { org: OrgWithRole }).org;
		const { getDb } = await import("#/lib/server/db");
		const { orgServices } = await import("@tripwire/db");
		await orgServices.setOrgTimezone(getDb().db, {
			orgId: org.id,
			timezone: data.timezone,
		});
		return { timezone: data.timezone };
	});
