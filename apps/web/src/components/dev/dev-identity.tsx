import { useQuery } from "@tanstack/react-query";
import type { KeyboardEvent } from "react";
import { Button } from "#/components/glaze/ui/button";
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
	return (
		<div className="flex shrink-0 items-center gap-1 border-t border-line-faint py-1.5 ps-3 pe-1.5">
			<p className="min-w-0 flex-1 truncate type-caption text-text-2">
				{whoami ? (whoami.signedIn ? whoami.email : "Signed out") : null}
			</p>
			{whoami?.signedIn ? (
				<Button
					disabled={busy !== null && busy !== "logout"}
					onClick={onLogout}
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
				onClick={onReset}
				onKeyDown={stopCommandKeys}
				pending={busy === "reset"}
				size="sm"
				variant="ghost"
			>
				Reset
			</Button>
		</div>
	);
}
