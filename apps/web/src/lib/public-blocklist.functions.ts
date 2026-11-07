import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const blocklistSearchSchema = z.object({
	q: z.string().trim().max(100).catch("").default(""),
	page: z.coerce.number().int().min(1).max(400).catch(1).default(1),
});

const PAGE_SIZE = 25;

export const getPublicSharedBlocklist = createServerFn({ method: "GET" })
	.inputValidator(blocklistSearchSchema)
	.handler(async ({ data }) => {
		const { loadPublishedSharedBlocklist } = await import(
			"@tripwire/utils/shared-blocklist"
		);
		const snapshot = await loadPublishedSharedBlocklist();
		if (!snapshot) return null;
		const query = data.q.toLowerCase().replace(/^@/, "");
		const matches = snapshot.entries.filter(
			(entry) =>
				entry.login.toLowerCase().includes(query) || entry.accountId === query,
		);
		const pageCount = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
		const page = Math.min(data.page, pageCount);
		const start = (page - 1) * PAGE_SIZE;
		return {
			revision: snapshot.revision,
			publishedAt: snapshot.publishedAt,
			total: snapshot.entries.length,
			matches: matches.length,
			page,
			pageCount,
			entries: matches.slice(start, start + PAGE_SIZE),
		};
	});
