import { getRouteApi } from "@tanstack/react-router";
import { BrandLockup } from "#/components/auth/brand-lockup";
import { ForgeGrid } from "#/components/auth/forge-grid";
import { LoginFaq } from "#/components/auth/login-faq";
import { WebviewNotice } from "#/components/auth/webview-notice";
import { DevPersonaDisclosure } from "#/components/dev/persona-disclosure";
import { ShaderDither } from "#/components/dither/shader-dither";
import { Card, CardContent } from "#/components/glaze/ui/card";

const route = getRouteApi("/login");

export function LoginPage() {
	const { redirect } = route.useSearch();
	return (
		<div className="relative isolate flex min-h-dvh flex-col items-center justify-center bg-page px-4 pt-10 pb-40">
			<ShaderDither className="-z-10 top-auto h-40" mask="bottom" />
			<div className="flex w-full max-w-sm flex-col items-center gap-6">
				<BrandLockup />

				<div className="flex flex-col items-center gap-1.5 text-center">
					<h1 className="type-heading text-balance">Sign in</h1>
					<p className="type-body-sm text-pretty text-text-2">
						Continue with the account that hosts your repos.
					</p>
				</div>

				<Card aria-label="Sign in" className="w-full" role="group">
					<CardContent>
						<ForgeGrid redirect={redirect} />
						<LoginFaq />
					</CardContent>
				</Card>

				<WebviewNotice />
				{import.meta.env.DEV ? <DevPersonaDisclosure /> : null}
			</div>
		</div>
	);
}
