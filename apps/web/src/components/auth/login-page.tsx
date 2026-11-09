import { getRouteApi } from "@tanstack/react-router";
import { BrandLockup } from "#/components/auth/brand-lockup";
import { ForgeGrid } from "#/components/auth/forge-grid";
import { LoginFaq } from "#/components/auth/login-faq";
import { WebviewNotice } from "#/components/auth/webview-notice";
import { DevScenarioDisclosure } from "#/components/dev/dev-scenario-disclosure";
import { ShaderDither } from "#/components/dither/shader-dither";
import { Card, CardContent } from "#/design-system/ui/card";

const route = getRouteApi("/login");

export function LoginPage() {
	const { redirect } = route.useSearch();
	return (
		<div data-layout-role="login-shell">
			<ShaderDither className="login-dither" mask="bottom" />
			<div data-layout-role="login-content">
				<BrandLockup />

				<header data-layout-role="login-header">
					<h1>Sign in</h1>
					<p>Continue with the account that hosts your repos.</p>
				</header>

				<Card aria-label="Sign in" data-layout-role="login-card" role="group">
					<CardContent>
						<ForgeGrid redirect={redirect} />
						<LoginFaq />
					</CardContent>
				</Card>

				<WebviewNotice />
				{import.meta.env.DEV ? <DevScenarioDisclosure /> : null}
			</div>
		</div>
	);
}
