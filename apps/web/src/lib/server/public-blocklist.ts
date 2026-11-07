import {
	blocklistGitHubRepositorySchema,
	SHARED_BLOCKLIST_REPOSITORY,
} from "@tripwire/contracts";
import { loadPublishedSharedBlocklist } from "@tripwire/utils/shared-blocklist";

let repositoryStars: Promise<number | null> | undefined;
let refreshStarsAt = 0;

export function getBlocklistRepositoryStars(): Promise<number | null> {
	if (!repositoryStars || Date.now() >= refreshStarsAt) {
		refreshStarsAt = Date.now() + 5 * 60_000;
		repositoryStars = fetch(
			`https://api.github.com/repos${new URL(SHARED_BLOCKLIST_REPOSITORY).pathname}`,
			{ signal: AbortSignal.timeout(1500) },
		)
			.then(async (response) => {
				if (!response.ok) return null;
				const parsed = blocklistGitHubRepositorySchema.safeParse(
					await response.json(),
				);
				return parsed.success ? parsed.data.stargazers_count : null;
			})
			.catch(() => null);
	}
	return repositoryStars;
}

export async function handlePublicBlocklist(
	request: Request,
	load = loadPublishedSharedBlocklist,
): Promise<Response> {
	const headers = {
		"Access-Control-Allow-Origin": "*",
		Allow: "GET, HEAD, OPTIONS",
		"Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
		"Cache-Control": "no-store",
	};
	if (request.method === "OPTIONS")
		return new Response(null, { status: 204, headers });
	if (request.method !== "GET" && request.method !== "HEAD") {
		return Response.json(
			{ error: "Method not allowed" },
			{ status: 405, headers },
		);
	}
	const snapshot = await load();
	const status = snapshot ? 200 : 503;
	if (snapshot) headers["Cache-Control"] = "public, max-age=30";
	const data = snapshot ?? {
		error: "No current blocklist snapshot is available",
	};
	if (request.method === "HEAD") {
		return new Response(null, {
			status,
			headers: { ...headers, "Content-Type": "application/json" },
		});
	}
	return Response.json(data, { status, headers });
}
