import { GithubIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { toast } from "sonner";
import { TripwireLogo } from "#/components/common/tripwire-logo";
import { Button } from "#/components/ui/button";
import { authClient } from "#/lib/auth-client";
import { siteConfig } from "#/lib/site-config";

export function LoginPage() {
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
							callbackURL: "/",
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
