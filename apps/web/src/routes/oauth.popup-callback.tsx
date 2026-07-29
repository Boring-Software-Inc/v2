import { track } from "@databuddy/sdk";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { TripwireLogo } from "#/components/common/tripwire-logo";
import { Button } from "#/components/ui/button";
import { Spinner } from "#/components/ui/spinner";
import { sessionInfoQueryOptions } from "#/lib/auth.query";
import { buildSeo, formatPageTitle } from "#/lib/seo";

/**
 * Post-auth closer page for the waitlist popup. Notifies the opener via
 * postMessage (STRICT target origin), then shows a confirmation and lets the
 * user close the window themselves — we don't auto-close. No reachable opener
 * (popup blocked / COOP severed) → navigates in place.
 */
export const Route = createFileRoute("/oauth/popup-callback")({
	component: PopupCallbackPage,
	validateSearch: (
		search: Record<string, unknown>,
	): { opener?: string; error?: string; mode?: string } => ({
		opener: typeof search.opener === "string" ? search.opener : undefined,
		error: typeof search.error === "string" ? search.error : undefined,
		mode: typeof search.mode === "string" ? search.mode : undefined,
	}),
	head: ({ match }) =>
		buildSeo({
			path: match.pathname,
			title: formatPageTitle("Finishing up"),
			description: "Completing your Tripwire waitlist request.",
			noindex: true,
		}),
});

/** Message channel name shared with the landing-site listener. */
const MESSAGE_TYPE = "tripwire:waitlist";

/** Exact origin to postMessage to, or null if `opener` isn't allowlisted. */
function resolveTargetOrigin(opener: string | undefined): string | null {
	const allowed = (import.meta.env.VITE_WAITLIST_OPENER_ORIGINS ?? "")
		.split(",")
		.map((o: string) => o.trim())
		.filter(Boolean);
	return opener && allowed.includes(opener) ? opener : null;
}

function postToOpener(payload: unknown, targetOrigin: string | null): boolean {
	if (!targetOrigin) return false;
	try {
		if (window.opener && !window.opener.closed) {
			window.opener.postMessage(payload, targetOrigin);
			return true;
		}
	} catch {
		// Cross-origin opener severed (COOP) — fall through to in-place nav.
	}
	return false;
}

/**
 * Approved users: send the opener (main tab) into the app, then close the
 * popup. Navigating a cross-origin opener is allowed (it's navigation, not a
 * read). No reachable opener → navigate this window instead.
 */
function launchApp(): void {
	const home = `${window.location.origin}/`;
	try {
		if (window.opener && !window.opener.closed) {
			window.opener.location.href = home;
			window.close();
			return;
		}
	} catch {
		// Opener not navigable — fall through to navigating this window.
	}
	window.location.href = home;
}

type View =
	| { kind: "working" }
	| { kind: "waitlisted"; email: string | null }
	| { kind: "approved" }
	| { kind: "error" };

function PopupCallbackPage() {
	const router = useRouter();
	const { opener, error, mode } = Route.useSearch();
	const { data, isLoading } = useQuery({
		...sessionInfoQueryOptions(),
		staleTime: 0,
	});
	const done = useRef(false);
	const [view, setView] = useState<View>({ kind: "working" });

	useEffect(() => {
		if (done.current) return;
		const targetOrigin = resolveTargetOrigin(opener);
		// `mode=popup` (stamped by the landing, threaded through OAuth) is the popup
		// detector — NOT window.opener, which a COOP header could sever silently and
		// recreate the dash-in-popup bug. window.opener is the delivery check only.
		const inPopup = mode === "popup";

		// In a popup but couldn't deliver → allowlist drift or a severed opener.
		// Report it so the next misconfig is a dashboard blip, not a user report.
		const report = (posted: boolean) => {
			if (inPopup && !posted) {
				track("waitlist_notify_failed", {
					opener: opener ?? "unknown",
					reason: targetOrigin
						? "opener_unreachable"
						: "origin_not_allowlisted",
				});
			}
		};

		if (error) {
			done.current = true;
			report(
				postToOpener({ type: MESSAGE_TYPE, status: "error" }, targetOrigin),
			);
			if (inPopup) {
				setView({ kind: "error" });
			} else {
				router.navigate({ to: "/login" });
			}
			return;
		}

		if (isLoading) return;
		done.current = true;
		const user = data?.user;

		if (!user) {
			report(
				postToOpener({ type: MESSAGE_TYPE, status: "error" }, targetOrigin),
			);
			if (inPopup) {
				setView({ kind: "error" });
			} else {
				router.navigate({ to: "/login" });
			}
			return;
		}

		report(
			postToOpener(
				{ type: MESSAGE_TYPE, status: user.accessStatus, name: user.name },
				targetOrigin,
			),
		);
		if (inPopup) {
			// In a popup: ALWAYS show the confirmation + Close, even if the opener
			// couldn't be notified. NEVER render the dashboard inside the popup.
			setView(
				user.accessStatus === "approved"
					? { kind: "approved" }
					: { kind: "waitlisted", email: user.email },
			);
			return;
		}
		// True full-page flow (popup blocked → redirect): continue in place.
		router.navigate({ to: user.accessStatus === "approved" ? "/" : "/queue" });
	}, [error, isLoading, data, opener, mode, router]);

	if (view.kind === "working") {
		return (
			<Shell>
				<Spinner size={16} className="text-muted-foreground" />
			</Shell>
		);
	}

	if (view.kind === "error") {
		return (
			<Shell>
				<Heading>Sign-in didn't finish</Heading>
				<Body>Close this window and start again from the sign-in page.</Body>
				<CloseButton />
			</Shell>
		);
	}

	if (view.kind === "approved") {
		return (
			<Shell>
				<Heading>You're in</Heading>
				<Body>Your account already has access.</Body>
				<div className="flex flex-col items-center gap-2.5">
					<Button variant="default" size="sm" onClick={launchApp}>
						Launch app
					</Button>
					<button
						type="button"
						onClick={() => window.close()}
						className="text-[12px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
					>
						Close window
					</button>
				</div>
			</Shell>
		);
	}

	return (
		<Shell>
			<Heading>You're on the waitlist</Heading>
			<Body>
				Tripwire is in closed beta. We'll email{" "}
				{view.email ? (
					<span className="text-foreground">{view.email}</span>
				) : (
					"you"
				)}{" "}
				when you're approved.
			</Body>
			<p className="text-[13px] text-muted-foreground">
				You can close this window.
			</p>
			<CloseButton />
		</Shell>
	);
}

function Shell({ children }: { children: ReactNode }) {
	return (
		<div className="flex min-h-dvh w-full flex-col items-center justify-center gap-5 bg-background px-8 text-center">
			<TripwireLogo className="text-foreground" size={30} />
			{children}
		</div>
	);
}

function Heading({ children }: { children: ReactNode }) {
	return <h1 className="font-semibold text-lg text-foreground">{children}</h1>;
}

function Body({ children }: { children: ReactNode }) {
	return (
		<p className="max-w-[340px] text-[13px] text-muted-foreground leading-relaxed">
			{children}
		</p>
	);
}

function CloseButton() {
	return (
		<Button variant="outline" size="sm" onClick={() => window.close()}>
			Close window
		</Button>
	);
}
