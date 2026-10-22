import { type RepoLabel, repoLabelSchema } from "@tripwire/contracts";
import { z } from "zod";
import type { GithubHttp } from "./http.ts";

const MAX_PAGES = 10;

const labelRowSchema = z.object({
	name: z.string(),
	color: z.string(),
	description: z.string().nullable().optional(),
});

export async function listRepoLabels(
	http: GithubHttp,
	repoFullName: string,
): Promise<RepoLabel[]> {
	const found: RepoLabel[] = [];
	let path: string | null = `/repos/${repoFullName}/labels?per_page=100`;
	for (let page = 0; path && page < MAX_PAGES; page++) {
		const result: { body: unknown; next: string | null } = await http.getPage(
			repoFullName,
			path,
		);
		for (const row of z.array(z.unknown()).parse(result.body)) {
			const parsed = labelRowSchema.safeParse(row);
			const label = parsed.success
				? repoLabelSchema.safeParse({
						name: parsed.data.name,
						color: parsed.data.color,
						description: parsed.data.description ?? null,
					})
				: null;
			if (label?.success) {
				found.push(label.data);
			}
		}
		path = result.next;
	}
	return found;
}
