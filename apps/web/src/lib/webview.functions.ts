import { createServerFn } from "@tanstack/react-start";
import { detectWebview, type WebviewHost } from "#/lib/webview";

/**
 * Same detection, run against the request header so the notice ships with the
 * first render instead of popping in after hydration. The origin travels with
 * it so the card can build an absolute url without `window`.
 */
export const getWebviewHost = createServerFn({ method: "GET" }).handler(
	async (): Promise<{ host: WebviewHost | null; origin: string }> => {
		const { getStartContext } = await import("@tanstack/start-storage-context");
		const { request } = getStartContext();
		const userAgent = request.headers.get("user-agent") ?? "";
		return {
			host: detectWebview(userAgent),
			origin: new URL(request.url).origin,
		};
	},
);
