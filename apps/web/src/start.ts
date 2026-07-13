import { createMiddleware, createStart } from "@tanstack/react-start";

/**
 * Better Auth is mounted HERE, as global request middleware — /api/auth is
 * served by the web head itself (same-origin cookies, OAuth callback on
 * :3000) before the router ever sees the request. The same middleware
 * proxies the SSE stream to the api head with the session cookie attached,
 * so the browser's EventSource stays same-origin and the api can gate it.
 */
const authRequestMiddleware = createMiddleware({ type: "request" }).server(
	async ({ next, request }) => {
		const url = new URL(request.url);
		// DEV persona switcher (§13). `import.meta.env.DEV` is a compile-time
		// constant, so this whole branch is dead-code-eliminated from the
		// production bundle — the endpoint cannot exist in prod.
		if (import.meta.env.DEV && url.pathname.startsWith("/api/dev/")) {
			const { handleDevRequest } = await import("#/lib/server/dev/handler");
			return await handleDevRequest(request);
		}
		if (url.pathname === "/api/events/stream") {
			const apiOrigin = process.env.VITE_API_URL ?? "http://localhost:8787";
			return await fetch(`${apiOrigin}/events/stream`, {
				headers: { cookie: request.headers.get("cookie") ?? "" },
				signal: request.signal,
			});
		}
		if (!url.pathname.startsWith("/api/auth")) {
			return await next();
		}
		const { getAuth } = await import("#/lib/server/auth");
		const auth = getAuth();
		if (!auth) {
			return new Response(
				JSON.stringify({ error: "auth disabled (BETTER_AUTH_SECRET unset)" }),
				{ status: 503, headers: { "content-type": "application/json" } },
			);
		}
		return await auth.handler(request);
	},
);

export const startInstance = createStart(() => ({
	requestMiddleware: [authRequestMiddleware],
}));
