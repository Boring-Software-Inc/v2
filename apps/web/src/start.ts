import { captureException } from "@sentry/node";
import { isNotFound, isRedirect } from "@tanstack/react-router";
import { createMiddleware, createStart } from "@tanstack/react-start";
import { parseRunOgPath } from "#/lib/run-og";
import { isServerOnlyAuthPath } from "#/lib/server-only-auth-paths";

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
		const runOg = parseRunOgPath(url.pathname);
		if (runOg && (request.method === "GET" || request.method === "HEAD")) {
			const { handleRunOgRequest } = await import(
				"#/lib/server/og/run-og-handler"
			);
			return await handleRunOgRequest(runOg.runId, runOg.hash);
		}
		if (
			import.meta.env.DEV &&
			process.env.PGLITE_DATA_DIR &&
			url.pathname === "/api/events/stream"
		) {
			const { handleDevLiveStream } = await import(
				"#/lib/server/dev/live-stream"
			);
			return await handleDevLiveStream(request);
		}
		if (url.pathname === "/api/events/stream") {
			const apiOrigin = process.env.VITE_API_URL ?? "http://localhost:8787";
			return await fetch(`${apiOrigin}/events/stream`, {
				headers: { cookie: request.headers.get("cookie") ?? "" },
				signal: request.signal,
			});
		}
		const authMetadata =
			url.pathname.startsWith("/.well-known/oauth-authorization-server") ||
			url.pathname.startsWith("/.well-known/openid-configuration");
		if (!(url.pathname.startsWith("/api/auth") || authMetadata)) {
			return await next();
		}
		if (isServerOnlyAuthPath(url.pathname)) {
			return new Response("not found", { status: 404 });
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

/**
 * Baseline security + cache headers on every response (§launch hardening). The
 * login page was iframeable (clickjacking) — `frame-ancestors 'none'` +
 * `X-Frame-Options: DENY` close that. HTML is served `no-cache` so a
 * heuristically-cached shell can't reference purged asset hashes after a deploy
 * and white-screen; hashed assets stay immutable via their own filenames.
 */
const securityHeadersMiddleware = createMiddleware({ type: "request" }).server(
	async ({ next }) => {
		const response = (await next()) as unknown as Response;
		if (response && typeof response.headers?.set === "function") {
			const h = response.headers;
			h.set("X-Content-Type-Options", "nosniff");
			h.set("X-Frame-Options", "DENY");
			h.set("Content-Security-Policy", "frame-ancestors 'none'");
			h.set("Referrer-Policy", "strict-origin-when-cross-origin");
			if (import.meta.env.PROD) {
				h.set(
					"Strict-Transport-Security",
					"max-age=63072000; includeSubDomains; preload",
				);
			}
			if ((h.get("content-type") ?? "").includes("text/html")) {
				h.set("Cache-Control", "no-cache");
			}
		}
		return response as never;
	},
);

const sentryRequestMiddleware = createMiddleware({ type: "request" }).server(
	async ({ next }) => {
		try {
			return await next();
		} catch (error) {
			captureException(error);
			throw error;
		}
	},
);

const sentryFunctionMiddleware = createMiddleware({ type: "function" }).server(
	async ({ next }) => {
		try {
			return await next();
		} catch (error) {
			if (!isRedirect(error) && !isNotFound(error)) {
				captureException(error);
			}
			throw error;
		}
	},
);

const devLatencyMiddleware = createMiddleware({ type: "function" }).server(
	async ({ next }) => {
		if (import.meta.env.DEV) {
			const { getCookie } = await import("@tanstack/react-start/server");
			const { DEV_LATENCY_COOKIE, devLatencyMs } = await import(
				"#/lib/dev/scenarios"
			);
			const delay = devLatencyMs(getCookie(DEV_LATENCY_COOKIE));
			if (delay > 0) {
				await new Promise((resolve) => setTimeout(resolve, delay));
			}
		}
		return await next();
	},
);

export const startInstance = createStart(() => ({
	requestMiddleware: [
		sentryRequestMiddleware,
		securityHeadersMiddleware,
		authRequestMiddleware,
	],
	functionMiddleware: import.meta.env.DEV
		? [sentryFunctionMiddleware, devLatencyMiddleware]
		: [sentryFunctionMiddleware],
}));
