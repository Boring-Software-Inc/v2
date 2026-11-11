import type { AccessStatus } from "@tripwire/contracts";
import { useState } from "react";
import { ConfirmDestructiveDialog } from "#/components/common/confirm-destructive-dialog";
import { TripwireLogo } from "#/components/common/tripwire-logo";
import { Avatar } from "#/design-system/ui/avatar";
import { Button } from "#/design-system/ui/button";
import { useSignOut } from "#/hooks/use-sign-out";

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
	const signOut = useSignOut();
	const [signOutOpen, setSignOutOpen] = useState(false);
	const rejected = status === "rejected";

	return (
		<div data-layout-role="access-pending-shell">
			<div data-layout-role="access-pending-content">
				<TripwireLogo className="access-pending-logo" size={28} />

				<div data-layout-role="access-pending-message">
					<h1>
						{rejected
							? "Your access request was declined"
							: "You're on the waitlist"}
					</h1>
					<p>
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

				<div data-layout-role="access-pending-account">
					{email ? (
						<>
							<Avatar
								decorative
								name={email}
								size="sm"
								src={image ?? undefined}
							/>
							<span>{email}</span>
						</>
					) : null}
					<Button
						onClick={() => setSignOutOpen(true)}
						size="sm"
						type="button"
						variant="ghost"
					>
						Sign out
					</Button>
				</div>
				<ConfirmDestructiveDialog
					actionLabel="Sign out"
					description="Your session on this device ends. You'll need to sign in again to check your access status."
					onConfirm={() => signOut.mutateAsync()}
					onOpenChange={setSignOutOpen}
					open={signOutOpen}
					pendingLabel="Signing out"
					title="Sign out of Tripwire?"
				/>
			</div>
		</div>
	);
}
