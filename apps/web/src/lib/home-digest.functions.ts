import { createServerFn } from "@tanstack/react-start";
import { homeDigestInputSchema, homeDigestSchema } from "@tripwire/contracts";
import { aggregateHomeDigest } from "#/lib/home-digest";
import { accessGuardMiddleware } from "#/lib/server/gated-server-fn";
import {
	type OrgContext,
	orgPermissionMiddleware,
} from "#/lib/server/org-guard";

export const getHomeDigest = createServerFn({ method: "GET" })
	.middleware([accessGuardMiddleware, orgPermissionMiddleware("activity:read")])
	.inputValidator(homeDigestInputSchema)
	.handler(async ({ context }) => {
		const { homeDigestServices } = await import("@tripwire/db");
		const { getDb } = await import("#/lib/server/db");
		const org = (context as OrgContext).org;
		const to = new Date();
		const from = new Date(to.getTime() - 7 * 86_400_000);
		const repos = await homeDigestServices.loadHomeDigestRepos(
			getDb().db,
			org.id,
			from,
			to,
			org.permissions.includes("rules:read"),
		);
		return homeDigestSchema.parse(aggregateHomeDigest(repos, from, to));
	});
