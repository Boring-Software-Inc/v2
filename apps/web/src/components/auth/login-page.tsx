import { GithubIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { getRouteApi } from "@tanstack/react-router";
import { TripwireLogo } from "#/components/common/tripwire-logo";
import { DevPersonaDisclosure } from "#/components/dev/persona-disclosure";
import { Button } from "#/components/ui/button";
import { Dither } from "#/components/ui/dither";
import { toast } from "#/components/ui/toast";
import { authClient } from "#/lib/auth-client";
import { siteConfig } from "#/lib/site-config";

const route = getRouteApi("/login");

export function LoginPage() {
	// Where OAuth lands after sign-in — lets /invite/:token round-trip a
	// signed-out redeemer back to the link instead of dropping them at "/".
	const { redirect } = route.useSearch();
	return (
		<div className="flex min-h-dvh flex-col items-center justify-center bg-background p-2">
			<div className="flex flex-1 items-center justify-center self-stretch overflow-clip rounded-lg bg-surface-1 sm:rounded-xl">
				<div className="relative flex w-[334px] max-w-full shrink-0 flex-col gap-2 overflow-clip rounded-[10px] border border-border bg-surface-2 p-1">
					<Dither className="opacity-25" />

					<div className="relative flex items-center justify-between gap-1 px-3 py-1.5">
						<div className="flex flex-col items-start gap-2">
							<p className="font-medium text-foreground text-xs leading-4">
								welcome back
							</p>
							<p className="text-left text-muted-foreground text-xs leading-5">
								{siteConfig.tagline}
							</p>
						</div>
						<TripwireLogo className="shrink-0 text-foreground" size={20} />
					</div>

					<Button
						className="relative w-full rounded-sm border border-border bg-surface-1 text-foreground hover:bg-secondary"
						iconLeft={
							<HugeiconsIcon icon={GithubIcon} size={16} strokeWidth={2} />
						}
						onClick={async () => {
							const { error } = await authClient.signIn.social({
								provider: "github",
								callbackURL: redirect ?? "/",
							});
							if (error) {
								toast(
									error.message ??
										"sign-in failed — is the github oauth app configured?",
								);
							}
						}}
					>
						continue with github
					</Button>
				</div>
			</div>
			{import.meta.env.DEV ? <DevPersonaDisclosure /> : null}
		</div>
	);
}
