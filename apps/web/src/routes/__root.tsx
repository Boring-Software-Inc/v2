import type { QueryClient } from "@tanstack/react-query";
import {
	createRootRouteWithContext,
	HeadContent,
	Outlet,
	redirect,
	Scripts,
} from "@tanstack/react-router";
import { LayoutGroup } from "motion/react";
import { ThemeProvider } from "next-themes";
import { Toaster } from "#/components/ui/sonner";
import { getSessionInfo } from "#/lib/auth.functions";
import { isPublicPath } from "#/lib/run-access";
import { siteConfig } from "#/lib/site-config";

import appCss from "../styles.css?url";

export const Route = createRootRouteWithContext<{
	queryClient: QueryClient;
}>()({
	/**
	 * §10 — Better Auth gates the dashboard, then onboarding gates it again: a
	 * signed-in user with no active repo goes to /onboarding (same shape as the
	 * auth redirect to /login). When auth env is absent (local dev) both gates
	 * stand open. The run page is unlisted-public (isPublicPath) so blocked
	 * contributors can read the judgment — they can't sign in.
	 */
	beforeLoad: async ({ location }) => {
		if (isPublicPath(location.pathname)) {
			return;
		}
		// The dev auto-login trampoline renders without a session (it mints one).
		if (import.meta.env.DEV && location.pathname === "/dev/auto-login") {
			return;
		}
		const session = await getSessionInfo();
		if (session.authEnabled && !session.user) {
			// §13 auto-login: in dev, silently establish the default persona
			// instead of bouncing to /login. /login stays reachable directly.
			if (import.meta.env.DEV && location.pathname !== "/login") {
				throw redirect({
					to: "/dev/auto-login",
					search: { to: location.pathname },
				});
			}
			throw redirect({ to: "/login" });
		}
		if (!session.user) {
			return;
		}
		// GitHub's Setup URL redirect carries `?installation_id=…`. However it's
		// configured (some apps land on `/setup`), funnel it into the real
		// callback WITH its params, so the onboarding redirect below can't strip
		// them.
		const search = location.search as {
			installation_id?: string;
			setup_action?: string;
			state?: string;
		};
		if (search.installation_id && location.pathname !== "/onboarding/setup") {
			throw redirect({
				to: "/onboarding/setup",
				search: {
					installation_id: search.installation_id,
					setup_action: search.setup_action,
					state: search.state,
				},
			});
		}
		if (!session.onboarded && !location.pathname.startsWith("/onboarding")) {
			throw redirect({ to: "/onboarding" });
		}
	},
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{ name: "application-name", content: siteConfig.name },
			{ name: "theme-color", content: siteConfig.themeColor },
			{ name: "format-detection", content: "telephone=no" },
			{ title: siteConfig.defaultTitle },
			{ name: "description", content: siteConfig.defaultDescription },
		],
		links: [{ rel: "stylesheet", href: appCss }],
	}),
	component: RootComponent,
	shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				<HeadContent />
			</head>
			<body className="min-h-screen bg-background font-sans antialiased">
				{children}
				<Scripts />
			</body>
		</html>
	);
}

function RootComponent() {
	return (
		<ThemeProvider
			attribute="class"
			defaultTheme="system"
			enableSystem
			disableTransitionOnChange
		>
			<LayoutGroup>
				<Outlet />
			</LayoutGroup>
			<Toaster />
		</ThemeProvider>
	);
}
