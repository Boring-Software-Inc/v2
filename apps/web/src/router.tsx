import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { RouteError } from "#/components/common/route-error";
import { NotFound } from "#/components/not-found";
import {
	AppQueryClientProvider,
	createAppQueryClient,
} from "#/lib/query-client";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
	const queryClient = createAppQueryClient();
	const router = createTanStackRouter({
		routeTree,
		context: {
			queryClient,
		},
		scrollRestoration: true,
		defaultPreload: "intent",
		defaultPreloadStaleTime: 0,
		defaultNotFoundComponent: NotFound,
		defaultErrorComponent: RouteError,
		Wrap: ({ children }) => (
			<AppQueryClientProvider queryClient={queryClient}>
				{children}
			</AppQueryClientProvider>
		),
	});

	setupRouterSsrQueryIntegration({
		router,
		queryClient,
		wrapQueryClient: false,
	});

	if (!import.meta.env.SSR && import.meta.env.VITE_SENTRY_DSN) {
		void import("@sentry/tanstackstart-react").then((Sentry) => {
			Sentry.init({
				dsn: import.meta.env.VITE_SENTRY_DSN,
				environment: import.meta.env.MODE,
				dataCollection: {
					userInfo: false,
					cookies: false,
					httpHeaders: false,
					httpBodies: [],
					urlQueryParams: false,
				},
				integrations: [Sentry.tanstackRouterBrowserTracingIntegration(router)],
				tracesSampleRate: import.meta.env.PROD ? 0.1 : 1.0,
			});
		});
	}

	return router;
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
