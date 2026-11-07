import { loadPublishedSharedBlocklist } from "@tripwire/utils/shared-blocklist";

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
