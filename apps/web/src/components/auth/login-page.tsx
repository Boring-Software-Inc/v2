import { GithubIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { getRouteApi } from "@tanstack/react-router";
import { toast } from "sonner";
import { TripwireLogo } from "#/components/common/tripwire-logo";
import { DevPersonaPanel } from "#/components/dev/persona-switcher";
import { Button } from "#/components/ui/button";
import { authClient } from "#/lib/auth-client";
import { siteConfig } from "#/lib/site-config";

const route = getRouteApi("/login");

export function LoginPage() {
	// Where OAuth lands after sign-in — lets /invite/:token round-trip a
	// signed-out redeemer back to the link instead of dropping them at "/".
	const { redirect } = route.useSearch();
	return (
		<div className="flex min-h-dvh flex-col items-center justify-center bg-background px-6">
			<div className="flex w-full max-w-xs flex-col items-center text-center">
				<TripwireLogo className="text-foreground" size={36} />
				<p className="mt-5 text-muted-foreground text-sm">
					{siteConfig.tagline}
				</p>
				<Button
					className="mt-8 w-full"
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
			{import.meta.env.DEV ? (
				<div className="mt-8 w-full max-w-sm border-border border-t pt-5">
					<p className="mb-2.5 text-center text-[11px] text-muted-foreground uppercase tracking-wide">
						dev personas
					</p>
					<DevPersonaPanel variant="grid" />
				</div>
			) : null}
		</div>
	);
}

export function LoginPageSkeleton() {
	return (
		<div className="flex min-h-dvh flex-col items-center justify-center bg-background px-6">
			<div className="flex w-full max-w-xs flex-col items-center gap-5">
				<div className="size-9 animate-pulse rounded-md bg-surface-1" />
				<div className="h-4 w-40 animate-pulse rounded bg-surface-1" />
				<div className="mt-3 h-9 w-full animate-pulse rounded-md bg-surface-1" />
			</div>
		</div>
	);
}
