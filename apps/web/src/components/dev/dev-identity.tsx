import { useQuery } from "@tanstack/react-query";
import { type KeyboardEvent, useState } from "react";
import { ConfirmDestructiveDialog } from "#/components/common/confirm-destructive-dialog";
import { Button } from "#/design-system/ui/button";
import { devWhoamiQueryOptions } from "#/lib/dev/dev.query";

function stopCommandKeys(event: KeyboardEvent<HTMLButtonElement>): void {
	event.stopPropagation();
}

interface DevIdentityProps {
	busy: string | null;
	onLogout: () => void;
	onReset: () => void;
}

export function DevIdentity({ busy, onLogout, onReset }: DevIdentityProps) {
	const { data: whoami } = useQuery(devWhoamiQueryOptions());
	const [signOutOpen, setSignOutOpen] = useState(false);
	const [resetOpen, setResetOpen] = useState(false);
	return (
		<>
			<div className="flex shrink-0 items-center gap-1 border-t border-line-faint py-1.5 ps-3 pe-1.5">
				<p className="min-w-0 flex-1 truncate type-caption text-text-2">
					{whoami ? (whoami.signedIn ? whoami.email : "Signed out") : null}
				</p>
				{whoami?.signedIn ? (
					<Button
						disabled={busy !== null && busy !== "logout"}
						onClick={() => setSignOutOpen(true)}
						onKeyDown={stopCommandKeys}
						pending={busy === "logout"}
						size="sm"
						variant="ghost"
					>
						Sign out
					</Button>
				) : null}
				<Button
					disabled={busy !== null && busy !== "reset"}
					onClick={() => setResetOpen(true)}
					onKeyDown={stopCommandKeys}
					pending={busy === "reset"}
					size="sm"
					variant="ghost"
				>
					Reset
				</Button>
			</div>
			<ConfirmDestructiveDialog
				actionLabel="Sign out"
				description="This ends the current development session."
				onConfirm={async () => onLogout()}
				onOpenChange={setSignOutOpen}
				open={signOutOpen}
				pendingLabel="Signing out"
				title="Sign out of the development session?"
			/>
			<ConfirmDestructiveDialog
				actionLabel="Reset development data"
				description="This clears the current development identity and scenario state."
				onConfirm={async () => onReset()}
				onOpenChange={setResetOpen}
				open={resetOpen}
				pendingLabel="Resetting"
				title="Reset development data?"
			/>
		</>
	);
}
