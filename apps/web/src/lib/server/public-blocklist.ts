import {
	type SharedBlocklistSnapshot,
	sharedBlocklistPageQuerySchema,
} from "@tripwire/contracts";
import { loadPublishedSharedBlocklist } from "@tripwire/utils/shared-blocklist";
import type { z } from "zod";

const PAGE_SIZE = 25;

export function pagePublicBlocklist(
	snapshot: SharedBlocklistSnapshot,
	{ q, page: requestedPage }: z.output<typeof sharedBlocklistPageQuerySchema>,
) {
	const query = (q ?? "").toLowerCase().replace(/^@/, "");
	const matches = query
		? snapshot.entries.filter(
				(entry) =>
					entry.login.toLowerCase().includes(query) ||
					entry.accountId === query,
			)
		: snapshot.entries;
	const pageCount = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
	const page = Math.min(requestedPage ?? 1, pageCount);
	const start = (page - 1) * PAGE_SIZE;
	return {
		...snapshot,
		total: snapshot.entries.length,
		matches: matches.length,
		page,
		pageCount,
		pageSize: PAGE_SIZE,
		entries: matches.slice(start, start + PAGE_SIZE),
	};
}

export async function handlePublicBlocklist(
	request: Request,
	load = loadPublishedSharedBlocklist,
): Promise<Response> {
	const params = new URL(request.url).searchParams;
	const plainText = params.get("format") === "txt";
	const headers = {
		"Access-Control-Allow-Origin": "*",
		Allow: "GET, HEAD, OPTIONS",
		"Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
		"Cache-Control": "no-store",
	};
	if (request.method === "OPTIONS")
		return new Response(null, { status: 204, headers });
	if (request.method !== "GET" && request.method !== "HEAD") {
		if (plainText)
			return new Response("Method not allowed\n", { status: 405, headers });
		return Response.json(
			{ error: "Method not allowed" },
			{ status: 405, headers },
		);
	}
	const snapshot = await load();
	const status = snapshot ? 200 : 503;
	if (snapshot) headers["Cache-Control"] = "public, max-age=30";
	if (plainText) {
		const body = snapshot
			? snapshot.entries.map(({ login }) => `${login}\n`).join("")
			: "No current blocklist snapshot is available\n";
		return new Response(request.method === "HEAD" ? null : body, {
			status,
			headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
		});
	}
	if (request.method === "HEAD") {
		return new Response(null, {
			status,
			headers: { ...headers, "Content-Type": "application/json" },
		});
	}
	const data = snapshot
		? pagePublicBlocklist(
				snapshot,
				sharedBlocklistPageQuerySchema.parse({
					q: params.get("q") ?? undefined,
					page: params.get("page") ?? undefined,
				}),
			)
		: { error: "No current blocklist snapshot is available" };
	return Response.json(data, { status, headers });
}
