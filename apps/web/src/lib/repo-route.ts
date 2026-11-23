import { type Forge, forgeSchema } from "@tripwire/contracts";
import { z } from "zod";

const REPO_ROUTE_SEPARATOR = ":";

const repoRouteIdentitySchema = z.object({
	forge: forgeSchema,
	owner: z.string().min(1),
	name: z.string().min(1),
});

interface RepoRouteIdentity {
	forge: Forge;
	owner: string;
	name: string;
}

/** Forge-qualified route segment. Forge owner and repository slugs cannot contain colons. */
export function repoRouteKey(repo: RepoRouteIdentity): string {
	return [repo.forge, repo.owner, repo.name].join(REPO_ROUTE_SEPARATOR);
}

/** Legacy name-only segments return null so unique historical URLs keep resolving. */
export function parseRepoRouteKey(value: string): RepoRouteIdentity | null {
	const parts = value.split(REPO_ROUTE_SEPARATOR);
	if (parts.length !== 3) return null;
	const parsed = repoRouteIdentitySchema.safeParse({
		forge: parts[0],
		owner: parts[1],
		name: parts[2],
	});
	return parsed.success ? parsed.data : null;
}
