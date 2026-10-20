import type { AccessStatus } from "@tripwire/contracts";
import { TripwireLogo } from "#/components/common/tripwire-logo";
import { Avatar } from "#/components/glaze/ui/avatar";
import { Button } from "#/components/glaze/ui/button";
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
		<div className="flex min-h-dvh w-full items-center justify-center bg-page px-4 py-10">
			<div className="flex w-full max-w-sm flex-col items-center gap-6 text-center">
				<TripwireLogo className="text-text-1" size={28} />

				<div className="flex flex-col gap-2">
					<h1 className="type-title">
						{rejected
							? "Your access request was not approved"
							: "You're on the waitlist"}
					</h1>
					<p className="type-body text-text-2">
						{rejected
							? "Tripwire is in a closed beta with limited places. We are letting more people in over time, so check back later."
							: "Your request to join the closed beta is in. We review each request by hand and email you when you are approved."}
					</p>
				</div>

				{onCheck && !rejected ? (
					<Button
						onClick={onCheck}
						pending={checking}
						pendingLabel="Checking status"
						size="sm"
						type="button"
						variant="secondary"
					>
						Check status
					</Button>
				) : null}

				<div className="flex items-center gap-2 type-body-sm text-text-2">
					{email ? (
						<>
							<Avatar
								decorative
								name={email}
								size="sm"
								src={image ?? undefined}
							/>
							<span className="min-w-0 truncate">{email}</span>
						</>
					) : null}
					<Button
						onClick={() => authClient.signOut()}
						size="sm"
						type="button"
						variant="ghost"
					>
						Sign out
					</Button>
				</div>
			</div>
		</div>
	);
}
