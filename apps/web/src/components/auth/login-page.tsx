import { getRouteApi } from "@tanstack/react-router";
import { ForgeGrid } from "#/components/auth/forge-grid";
import { LoginFaq } from "#/components/auth/login-faq";
import { WebviewNotice } from "#/components/auth/webview-notice";
import { TripwireWordmark } from "#/components/common/tripwire-wordmark";
import { DevPersonaDisclosure } from "#/components/dev/persona-disclosure";
import { ShaderDither } from "#/components/dither/shader-dither";
import { Card, CardContent } from "#/components/glaze/ui/card";

const route = getRouteApi("/login");

export function LoginPage() {
	// Where OAuth lands after sign-in — lets /invite/:token round-trip a
	// signed-out redeemer back to the link instead of dropping them at "/".
	const { redirect } = route.useSearch();
	return (
		<div className="relative isolate flex min-h-dvh flex-col items-center justify-center bg-page px-4 pt-10 pb-40">
			<ShaderDither className="-z-10 top-auto h-40" mask="bottom" />
			<div className="flex w-full max-w-sm flex-col gap-6">
				<div className="flex items-center gap-2">
					<TripwireWordmark
						className="shrink-0 text-text-1"
						height={20}
						width={32}
					/>
					<span className="type-heading">Tripwire</span>
				</div>

				<div className="flex flex-col gap-1">
					<h1 className="type-title">Welcome back</h1>
					<p className="type-body text-text-2">
						Sign in with the forge your code lives on.
					</p>
				</div>

				<Card aria-label="Sign in" role="group">
					<CardContent>
						<ForgeGrid redirect={redirect} />
						<LoginFaq />
					</CardContent>
				</Card>

				<WebviewNotice />
			</div>
			{import.meta.env.DEV ? <DevPersonaDisclosure /> : null}
		</div>
	);
}
