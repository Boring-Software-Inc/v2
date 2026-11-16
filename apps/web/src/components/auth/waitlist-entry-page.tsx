import { getRouteApi } from "@tanstack/react-router";
import { Status } from "@tripwire/ui/status";
import { useEffect, useRef } from "react";
import { TripwireLogo } from "#/components/common/tripwire-logo";
import { authClient } from "#/lib/auth-client";
import type { TrackingSearch } from "#/lib/track";

import "./auth-page-status.css";

const route = getRouteApi("/oauth/waitlist");

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

export function WaitlistEntryPage() {
	const { opener, mode, anonId, sessionId } = route.useSearch();
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
		<div data-layout-role="auth-page-status" data-auth-status-brand="">
			<TripwireLogo className="tone-content-primary" size={32} />
			<Status status="running">Connecting to GitHub</Status>
		</div>
	);
}
