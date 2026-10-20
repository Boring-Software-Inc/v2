import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { TripwireLogo } from "#/components/common/tripwire-logo";
import { Status } from "#/components/glaze/ui/status";
import { authClient } from "#/lib/auth-client";
import { buildSeo, formatPageTitle } from "#/lib/seo";

/**
 * Popup entry point for the cross-deployment "Join waitlist with GitHub" flow.
 * The landing site opens this in a popup; it starts GitHub sign-in and points
 * the OAuth callback at the closer, threading the opener origin through so the
 * closer knows which window to notify.
 */
export const Route = createFileRoute("/oauth/waitlist")({
	component: WaitlistEntryPage,
	validateSearch: (
		search: Record<string, unknown>,
	): { opener?: string; mode?: string } => ({
		opener: typeof search.opener === "string" ? search.opener : undefined,
		mode: typeof search.mode === "string" ? search.mode : undefined,
	}),
	head: ({ match }) =>
		buildSeo({
			path: match.pathname,
			title: formatPageTitle("Join the waitlist"),
			description: "Request Tripwire access with GitHub.",
			noindex: true,
		}),
});

function callbackPath(
	opener: string | undefined,
	mode: string | undefined,
	error?: string,
): string {
	const params = new URLSearchParams();
	if (opener) params.set("opener", opener);
	// Thread the popup marker through OAuth so the closer knows it's a popup even
	// if window.opener is later severed (COOP). See the closer's inPopup logic.
	if (mode) params.set("mode", mode);
	if (error) params.set("error", error);
	const qs = params.toString();
	return `/oauth/popup-callback${qs ? `?${qs}` : ""}`;
}

function WaitlistEntryPage() {
	const { opener, mode } = Route.useSearch();
	const started = useRef(false);

	useEffect(() => {
		if (started.current) return;
		started.current = true;
		// Initiate GitHub OAuth in this popup. New users are created as "pending"
		// server-side; the callback below notifies the opener.
		void authClient.signIn.social({
			provider: "github",
			callbackURL: callbackPath(opener, mode),
			errorCallbackURL: callbackPath(opener, mode, "oauth_failed"),
		});
	}, [opener, mode]);

	return (
		<div className="flex min-h-dvh w-full flex-col items-center justify-center gap-6 bg-page px-4">
			<TripwireLogo className="text-text-1" size={32} />
			<Status status="running">Connecting to GitHub</Status>
		</div>
	);
}
