import type {
	EventActor,
	StarredContributionCount,
	StarredContributionQuery,
} from "@tripwire/contracts";
import { z } from "zod";
import type { GithubHttp } from "./http.ts";

const MAX_PAGES = 10;
const repositorySchema = z.object({
	stargazerCount: z.int().min(0),
	visibility: z.string(),
	owner: z.object({ id: z.string() }),
});
const responseSchema = z.object({
	errors: z.array(z.unknown()).max(0).optional(),
	data: z.object({
		user: z
			.object({
				id: z.string(),
				databaseId: z.int(),
				history: z.object({
					nodes: z.array(
						z.union([
							repositorySchema.extend({ id: z.string() }),
							z.object({ id: z.string(), repository: repositorySchema }),
						]),
					),
					pageInfo: z.object({
						hasNextPage: z.boolean(),
						endCursor: z.string().nullable(),
					}),
				}),
			})
			.nullable(),
	}),
});

const REPO_FIELDS = "stargazerCount visibility owner { id }";
const OWNED = `repositories(first: 100, after: $cursor, ownerAffiliations: [OWNER],
	privacy: PUBLIC, orderBy: { field: STARGAZERS, direction: DESC }) {
	nodes { id ${REPO_FIELDS} }
	pageInfo { hasNextPage endCursor }
}`;
const MERGED = `pullRequests(first: 100, after: $cursor, states: [MERGED],
	orderBy: { field: CREATED_AT, direction: DESC }) {
	nodes { id repository { ${REPO_FIELDS} } }
	pageInfo { hasNextPage endCursor }
}`;

/** Read a bounded prefix and stop once there is enough evidence for a verdict. */
export async function countStarredContributions(
	http: GithubHttp,
	repo: string,
	author: EventActor,
	query: StarredContributionQuery,
): Promise<StarredContributionCount> {
	const owned = query.kind === "owned-repositories";
	const stars = owned ? query.minStars : query.minRepoStars;
	const excludeAuthor = !owned && query.repoOwnership === "exclude-author";
	const document = `query StarredContributions($login: String!, $cursor: String) {
		user(login: $login) { id databaseId history: ${owned ? OWNED : MERGED} }
	}`;
	const seen = new Set<string>();
	let cursor: string | null = null;
	let count = 0;
	for (let page = 0; page < MAX_PAGES; page++) {
		const response = responseSchema.parse(
			await http.post(repo, "/graphql", {
				query: document,
				variables: { login: author.login, cursor },
			}),
		);
		const user = response.data.user;
		if (!user || String(user.databaseId) !== author.externalId)
			return { count: 0, complete: false };
		for (const node of user.history.nodes) {
			const repository = "repository" in node ? node.repository : node;
			if (owned && repository.stargazerCount < stars)
				return { count, complete: true };
			if (seen.has(node.id)) continue;
			seen.add(node.id);
			if (
				repository.visibility === "PUBLIC" &&
				repository.stargazerCount >= stars &&
				(owned
					? repository.owner.id === user.id
					: !excludeAuthor || repository.owner.id !== user.id)
			) {
				count++;
				if (count >= query.min) return { count, complete: false };
			}
		}
		const { hasNextPage, endCursor } = user.history.pageInfo;
		if (!hasNextPage) return { count, complete: true };
		if (!endCursor || endCursor === cursor) return { count, complete: false };
		cursor = endCursor;
	}
	return { count, complete: false };
}
