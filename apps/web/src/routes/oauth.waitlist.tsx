import { createFileRoute } from "@tanstack/react-router";
import { oauthWaitlistSearchSchema } from "@tripwire/contracts";
import { useEffect, useRef } from "react";
import { TripwireLogo } from "#/components/common/tripwire-logo";
import { Status } from "#/design-system/ui/status";
import { authClient } from "#/lib/auth-client";
import { buildSeo, formatPageTitle } from "#/lib/seo";
import { type TrackingSearch, trackingSearch } from "#/lib/track";

/**
 * Popup entry point for the cross-deployment "Join waitlist with GitHub" flow.
 * The landing site opens this in a popup; it starts GitHub sign-in and points
 * the OAuth callback at the closer, threading the opener origin through so the
 * closer knows which window to notify.
 */
export const Route = createFileRoute("/oauth/waitlist")({
	component: WaitlistEntryPage,
	validateSearch: (
		search: Parameters<typeof oauthWaitlistSearchSchema.parse>[0],
	) => {
		const parsed = oauthWaitlistSearchSchema.parse(search);
		return {
			opener: parsed.opener,
			mode: parsed.mode,
			...trackingSearch(search),
		};
	},
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
	tracking: TrackingSearch,
	error?: string,
): string {
	const params = new URLSearchParams();
	if (tracking.anonId) params.set("anonId", tracking.anonId);
	if (tracking.sessionId) params.set("sessionId", tracking.sessionId);
	if (opener) params.set("opener", opener);
	// Thread the popup marker through OAuth so the closer knows it's a popup even
	// if window.opener is later severed (COOP). See the closer's inPopup logic.
	if (mode) params.set("mode", mode);
	if (error) params.set("error", error);
	const qs = params.toString();
	return `/oauth/popup-callback${qs ? `?${qs}` : ""}`;
}

function WaitlistEntryPage() {
	const { opener, mode, anonId, sessionId } = Route.useSearch();
	const started = useRef(false);

	useEffect(() => {
		if (started.current) return;
		started.current = true;
		// Initiate GitHub OAuth in this popup. New users are created as "pending"
		// server-side; the callback below notifies the opener.
		void authClient.signIn.social({
			provider: "github",
			callbackURL: callbackPath(opener, mode, { anonId, sessionId }),
			errorCallbackURL: callbackPath(
				opener,
				mode,
				{ anonId, sessionId },
				"oauth_failed",
			),
		});
	}, [opener, mode, anonId, sessionId]);

	return (
		<div className="flex min-h-dvh w-full flex-col items-center justify-center gap-6 bg-page px-4">
			<TripwireLogo className="text-text-1" size={32} />
			<Status status="running">Connecting to GitHub</Status>
		</div>
	);
}
