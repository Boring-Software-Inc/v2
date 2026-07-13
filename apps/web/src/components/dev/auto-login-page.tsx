import { getRouteApi } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { TripwireLogo } from "#/components/common/tripwire-logo";
import { DEFAULT_PERSONA } from "#/lib/dev/personas";

/**
 * DEV auto-login trampoline (§13) — reached when a gated route has no session
 * in a dev build. It silently establishes the DEFAULT persona and lands you in
 * the app, so the happy path is zero clicks and you never see /login. Outside a
 * dev build it just bounces to /login (the endpoint doesn't exist in prod).
 */
const api = getRouteApi("/dev/auto-login");

export function DevAutoLoginPage() {
	const { to } = api.useSearch();
	const fired = useRef(false);

	useEffect(() => {
		if (fired.current) {
			return;
		}
		fired.current = true;
		const fallback = () => window.location.assign("/login");
		if (!import.meta.env.DEV) {
			fallback();
			return;
		}
		void (async () => {
			try {
				const res = await fetch("/api/dev/login", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ persona: DEFAULT_PERSONA }),
				});
				if (!res.ok) {
					fallback();
					return;
				}
				const { landing } = (await res.json()) as { landing: string };
				window.location.assign(to || landing);
			} catch {
				fallback();
			}
		})();
	}, [to]);

	return (
		<div className="flex min-h-dvh flex-col items-center justify-center bg-background px-6">
			<div className="flex flex-col items-center gap-4 text-center">
				<TripwireLogo className="animate-pulse text-foreground" size={32} />
				<p className="text-muted-foreground text-xs">signing in…</p>
			</div>
		</div>
	);
}
