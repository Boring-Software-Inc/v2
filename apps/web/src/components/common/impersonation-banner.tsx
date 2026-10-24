import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Icon, UserAvatar } from "#/components/glaze/icon";
import { Button } from "#/components/glaze/ui/button";
import { toast } from "#/components/glaze/ui/toast";
import { minutesLeft } from "#/lib/admin-user-sheet";
import { sessionInfoQueryOptions } from "#/lib/auth.query";
import { stopImpersonating } from "#/lib/staff-users.functions";

const BAR_HEIGHT = "2.75rem";

function useMinuteClock(active: boolean): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!active) {
			return;
		}
		const timer = window.setInterval(() => setNow(Date.now()), 15_000);
		return () => window.clearInterval(timer);
	}, [active]);
	return now;
}

export function ImpersonationBanner() {
	const { data } = useQuery(sessionInfoQueryOptions());
	const impersonation = data?.impersonation ?? null;
	const user = data?.user ?? null;
	const active = impersonation !== null && user !== null;
	const now = useMinuteClock(active);
	const stop = useMutation({
		mutationFn: async () => {
			const result = await stopImpersonating();
			if (!result.ok) {
				throw new Error(result.error);
			}
			return result;
		},
		onSuccess: (result) =>
			window.location.assign(
				`/admin/users?user=${encodeURIComponent(result.userId)}`,
			),
		onError: (error) =>
			toast.fail(
				error instanceof Error
					? error.message
					: "Tripwire couldn't stop impersonating. Sign out instead.",
			),
	});

	useEffect(() => {
		if (!active) {
			return;
		}
		const root = document.documentElement;
		root.style.setProperty("--impersonation-bar", BAR_HEIGHT);
		return () => {
			root.style.removeProperty("--impersonation-bar");
		};
	}, [active]);

	if (!(impersonation && user)) {
		return null;
	}
	const minutes = minutesLeft(impersonation.expiresAt, now);
	return (
		<section
			aria-label="Impersonation"
			className="sticky top-0 z-(--z-sticky) flex h-11 shrink-0 items-center justify-between gap-3 border-line-faint border-b bg-warn-tint ps-5 pe-4 text-warn-text"
		>
			<div className="flex min-w-0 items-center gap-2.5">
				<Icon icon={UserAvatar} size={16} />
				<span className="truncate type-label">Viewing as {user.name}</span>
				{impersonation.login ? (
					<span className="hidden truncate type-body-sm sm:inline">
						{impersonation.login}
					</span>
				) : null}
			</div>
			<div className="flex shrink-0 items-center gap-3">
				<span className="hidden type-caption tabular-nums sm:inline">
					{minutes > 0 ? `Ends in ${minutes} min` : "Ending now"}
				</span>
				<Button
					onClick={() => stop.mutate()}
					pending={stop.isPending}
					pendingLabel="Stopping"
					size="sm"
				>
					Stop impersonating
				</Button>
			</div>
		</section>
	);
}
