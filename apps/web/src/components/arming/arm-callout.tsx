import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "#/components/ui/button";
import { toast } from "#/components/ui/toast";
import { armRepo } from "#/lib/arm.functions";
import { cn } from "#/lib/utils";

interface ArmCalloutProps {
	/** Org slug from the URL. */
	org: string;
	/** Repo NAME from the URL. */
	repo: string;
	repoFullName: string;
	/** hero dominates the home page; banner is the inline call on scoped pages. */
	variant?: "hero" | "banner";
	className?: string;
}

function useArm(org: string, repo: string, repoFullName: string) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: () => armRepo({ data: { org, repo } }),
		onSettled: async () => {
			// The whole dashboard re-derives from armed state — refetch broadly.
			await queryClient.invalidateQueries();
		},
		onSuccess: (result) => {
			if (result.armed) {
				toast.success(`tripwire is now watching ${repoFullName}`);
			}
		},
		onError: () => toast.error("couldn't arm the repo — try again"),
	});
}

/**
 * §4 — the unarmed state is a call to action, never an empty state. It DOMINATES
 * the page (hero on home) or leads it (banner on scoped pages) until resolved.
 */
export function ArmCallout({
	org,
	repo,
	repoFullName,
	variant = "banner",
	className,
}: ArmCalloutProps) {
	const arm = useArm(org, repo, repoFullName);

	if (variant === "hero") {
		return (
			<div
				className={cn(
					"flex flex-col gap-4 rounded-xl bg-surface-1 p-6 md:p-8",
					className,
				)}
			>
				<div className="flex flex-col gap-2">
					<h2 className="font-semibold text-2xl tracking-tight">
						tripwire isn't guarding{" "}
						<span className="font-mono text-xl">{repoFullName}</span>
					</h2>
					<p className="max-w-xl text-muted-foreground text-sm">
						unarmed, it ignores every change request here — no checks, no
						comments, no blocks. arm it to start checking each one against your
						rules and blocking the ones that break them.
					</p>
				</div>
				<Button
					className="w-fit"
					disabled={arm.isPending}
					onClick={() => arm.mutate()}
				>
					{arm.isPending ? "arming…" : "arm this repo"}
				</Button>
			</div>
		);
	}

	return (
		<div
			className={cn(
				"flex items-center gap-4 rounded-lg bg-surface-1 px-4 py-3",
				className,
			)}
		>
			<p className="min-w-0 flex-1 font-medium text-sm">
				not armed — tripwire ignores every change request here until you arm it.
			</p>
			<Button
				className="shrink-0"
				disabled={arm.isPending}
				onClick={() => arm.mutate()}
				size="sm"
			>
				{arm.isPending ? "arming…" : "arm"}
			</Button>
		</div>
	);
}
