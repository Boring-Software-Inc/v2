import { type RepoReviewer, repoReviewerSchema } from "@tripwire/contracts";
import { z } from "zod";
import type { GithubHttp } from "./http.ts";

const PAGE_SIZE = 100;
const MAX_PAGES = 10;

export interface ListRepoReviewersResult {
	reviewers: RepoReviewer[];
	/** GitHub advertised another page after the request cap. */
	truncated: boolean;
}

const collaboratorSchema = z.object({
	id: z.number(),
	login: z.string(),
	avatar_url: z.string(),
	role_name: z.string().optional(),
	permissions: z
		.object({
			admin: z.boolean().optional(),
			maintain: z.boolean().optional(),
			push: z.boolean().optional(),
		})
		.optional(),
});

const pageSchema = z.array(z.looseObject({}));

type Collaborator = z.infer<typeof collaboratorSchema>;

function permissionOf(collaborator: Collaborator): string | null {
	const granted = collaborator.permissions;
	if (!(granted?.admin || granted?.maintain || granted?.push)) {
		return null;
	}
	return (
		collaborator.role_name ??
		(granted.admin ? "admin" : granted.maintain ? "maintain" : "write")
	);
}

export async function listRepoReviewers(
	http: GithubHttp,
	repoFullName: string,
): Promise<ListRepoReviewersResult> {
	const found: RepoReviewer[] = [];
	let truncated = false;
	for (let page = 1; page <= MAX_PAGES; page++) {
		const { body, next } = await http.getPage(
			repoFullName,
			`/repos/${repoFullName}/collaborators?affiliation=all&permission=push&per_page=${PAGE_SIZE}&page=${page}`,
		);
		const rows = pageSchema.parse(body);
		for (const row of rows) {
			const collaborator = collaboratorSchema.safeParse(row);
			if (!collaborator.success) {
				continue;
			}
			const permission = permissionOf(collaborator.data);
			const reviewer = repoReviewerSchema.safeParse({
				id: collaborator.data.id,
				login: collaborator.data.login,
				avatarUrl: collaborator.data.avatar_url,
				permission,
			});
			if (permission && reviewer.success) {
				found.push(reviewer.data);
			}
		}
		truncated = next !== null;
		if (!truncated) {
			break;
		}
	}
	return { reviewers: found, truncated };
}
