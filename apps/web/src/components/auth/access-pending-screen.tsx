import type { AccessStatus } from "@tripwire/contracts";
import { TripwireLogo } from "#/components/common/tripwire-logo";
import { Button } from "#/components/ui/button";
import { Spinner } from "#/components/ui/spinner";
import { authClient } from "#/lib/auth-client";

/**
 * Minimal full-screen waitlist / access-status screen. Shared by the `/queue`
 * route and the `beforeLoad` gate. Ported from tripwire v1, v2 components.
 *
 * `onCheck` re-reads access status from the server (fresh DB read) so an
 * approval lands without a re-login; the caller navigates onward when it flips.
 */
export function AccessPendingScreen({
	email,
	image,
	status,
	onCheck,
	checking = false,
}: {
	email?: string | null;
	image?: string | null;
	status: AccessStatus;
	onCheck?: () => void;
	checking?: boolean;
}) {
	const rejected = status === "rejected";

	return (
		<div className="flex min-h-dvh w-full items-center justify-center bg-background px-6">
			<div className="flex w-full max-w-sm flex-col items-center gap-7 text-center">
				<TripwireLogo className="text-foreground" size={28} />

				<div className="flex flex-col gap-2.5">
					<h1 className="font-semibold text-lg text-foreground">
						{rejected ? "Not this time" : "You're on the waitlist"}
					</h1>
					<p className="text-[13px] text-muted-foreground leading-relaxed">
						{rejected
							? "Your access request wasn't approved. Thanks for your interest in Tripwire — feel free to check back as we open up more broadly."
							: "You applied with GitHub — you're in line for the closed beta. We review requests manually and will email you the moment you're approved."}
					</p>
				</div>

				{onCheck && !rejected ? (
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={onCheck}
						disabled={checking}
						iconLeft={checking ? <Spinner size={14} /> : null}
					>
						Check status
					</Button>
				) : null}

				<div className="flex items-center gap-2 text-[12px] text-muted-foreground">
					{image ? (
						<img
							alt=""
							className="size-5 rounded-full outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
							crossOrigin="anonymous"
							src={image}
						/>
					) : null}
					{email ? <span>{email}</span> : null}
					<span className="text-muted-foreground/60">·</span>
					<button
						type="button"
						onClick={() => authClient.signOut()}
						className="underline-offset-2 hover:text-foreground hover:underline"
					>
						Sign out
					</button>
				</div>
			</div>
		</div>
	);
}
