import { queryOptions } from "@tanstack/react-query";
import { getWebviewHost } from "#/lib/webview.functions";

export const webviewQueryKeys = {
	all: ["webview"] as const,
	host: () => [...webviewQueryKeys.all, "host"] as const,
};

/** The user agent cannot change under a loaded document — fetch it once. */
export const webviewHostQueryOptions = () =>
	queryOptions({
		queryKey: webviewQueryKeys.host(),
		queryFn: ({ signal }) => getWebviewHost({ signal }),
		staleTime: Number.POSITIVE_INFINITY,
	});
