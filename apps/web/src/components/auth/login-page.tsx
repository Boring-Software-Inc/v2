import { getRouteApi } from "@tanstack/react-router";
import { ForgeGrid } from "#/components/auth/forge-grid";
import { LoginFaq } from "#/components/auth/login-faq";
import { TripwireWordmark } from "#/components/common/tripwire-wordmark";
import { DevPersonaDisclosure } from "#/components/dev/persona-disclosure";
import { Dither } from "#/components/ui/dither";

const route = getRouteApi("/login");

export function LoginPage() {
	// Where OAuth lands after sign-in — lets /invite/:token round-trip a
	// signed-out redeemer back to the link instead of dropping them at "/".
	const { redirect } = route.useSearch();
	return (
		<div className="flex min-h-dvh flex-col items-center justify-center bg-background p-2">
			<div className="flex flex-1 items-center justify-center self-stretch overflow-clip rounded-lg bg-surface-0 sm:rounded-xl">
				<div className="flex w-[334px] max-w-full shrink-0 flex-col items-center gap-3">
					{/* The lockup sits OUTSIDE the card — the card is the form, the
					    wordmark is the room it's in. */}
					<div className="flex items-center gap-2 px-1">
						<TripwireWordmark
							className="shrink-0 text-foreground"
							height={20}
							width={32}
						/>
						<span className="font-medium text-foreground text-lg tracking-tight">
							tripwire
						</span>
					</div>

					<div className="relative flex w-full flex-col gap-1 overflow-clip rounded-[10px] border border-border bg-surface-2 p-0.5">
						<Dither className="opacity-25" speed={1.22} />

						<div className="relative flex flex-col items-start gap-1 px-2 py-1.5">
							<h1 className="font-medium text-foreground text-xs leading-4">
								welcome back
							</h1>
							<p className="text-left text-muted-foreground text-xs leading-5">
								sign in with the forge your code lives on.
							</p>
						</div>

						<ForgeGrid redirect={redirect} />
						<LoginFaq />
					</div>
				</div>
			</div>
			{import.meta.env.DEV ? <DevPersonaDisclosure /> : null}
		</div>
	);
}
