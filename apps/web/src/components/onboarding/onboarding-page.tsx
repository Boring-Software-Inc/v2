import { CheckmarkCircle02Icon, GithubIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { TripwireLogo } from "#/components/common/tripwire-logo";
import { Button } from "#/components/ui/button";
import { authQueryKeys } from "#/lib/auth.query";
import { chooseActiveRepo, type RepoLite } from "#/lib/onboarding.functions";
import {
	installUrlQueryOptions,
	onboardingQueryKeys,
	onboardingStateQueryOptions,
} from "#/lib/onboarding.query";
import { cn } from "#/lib/utils";

/** The cardless first-contact shell — the page IS the surface, no panel. */
function Shell({
	children,
	line,
}: {
	children: ReactNode;
	line: string;
}) {
	return (
		<div className="flex min-h-dvh flex-col items-center justify-center bg-background px-6 py-16">
			<div className="flex w-full max-w-sm flex-col items-center text-center">
				<TripwireLogo className="text-foreground" size={36} />
				<p className="mt-5 text-muted-foreground text-sm">{line}</p>
				<div className="mt-8 w-full">{children}</div>
			</div>
		</div>
	);
}

export function OnboardingPage() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { data: state, isLoading } = useQuery(onboardingStateQueryOptions());
	const { data: installUrl } = useQuery(installUrlQueryOptions());
	const [selectedId, setSelectedId] = useState<string | null>(null);

	const finish = useMutation({
		mutationFn: (repoId: string) => chooseActiveRepo({ data: { repoId } }),
		onSettled: async () => {
			await queryClient.invalidateQueries({ queryKey: authQueryKeys.all });
			await queryClient.invalidateQueries({
				queryKey: onboardingQueryKeys.all,
			});
		},
		onSuccess: (res) => {
			if (res.ok) {
				navigate({ to: "/" });
			} else {
				toast("couldn't select that repo — try again.");
			}
		},
	});

	// Exactly one repo granted ⇒ auto-select it and go straight to the dashboard.
	const repos = state?.repos ?? [];
	const single =
		state?.hasInstallation && !state.activeRepo && repos.length === 1;
	const autoFired = useRef(false);
	useEffect(() => {
		if (single && repos[0] && !autoFired.current) {
			autoFired.current = true;
			finish.mutate(repos[0].id);
		}
	}, [single, repos, finish]);

	if (isLoading) {
		return <OnboardingPageSkeleton />;
	}

	// Already onboarded (navigated here directly) — send them home.
	if (state?.activeRepo) {
		navigate({ to: "/" });
		return <OnboardingPageSkeleton />;
	}

	if (!state?.hasInstallation) {
		return (
			<Shell line="install the app and pick one repo to start.">
				<Button
					className="w-full"
					disabled={!installUrl}
					iconLeft={
						<HugeiconsIcon icon={GithubIcon} size={16} strokeWidth={2} />
					}
					onClick={() => {
						if (installUrl) {
							window.location.href = installUrl;
						}
					}}
				>
					install on github
				</Button>
				{installUrl ? null : (
					<p className="mt-4 text-muted-foreground text-xs">
						the github app isn't configured yet (set GITHUB_APP_SLUG).
					</p>
				)}
			</Shell>
		);
	}

	if (repos.length === 0 || single) {
		return (
			<Shell line="finishing setup.">
				<div className="flex flex-col items-center gap-3">
					<div className="size-5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
					<p className="text-muted-foreground text-xs">
						syncing the repos you just granted — this takes a moment.
					</p>
				</div>
			</Shell>
		);
	}

	return (
		<Shell line="pick one repo to start.">
			<div className="flex flex-col gap-1.5 text-left">
				{repos.map((repo) => (
					<RepoRow
						key={repo.id}
						onSelect={() => setSelectedId(repo.id)}
						repo={repo}
						selected={selectedId === repo.id}
					/>
				))}
			</div>
			<p className="mt-3 text-muted-foreground text-xs">
				one repo for now — the rest stay linked.
			</p>
			<Button
				className="mt-5 w-full"
				disabled={!selectedId || finish.isPending}
				onClick={() => selectedId && finish.mutate(selectedId)}
			>
				continue
			</Button>
		</Shell>
	);
}

function RepoRow({
	repo,
	selected,
	onSelect,
}: {
	repo: RepoLite;
	selected: boolean;
	onSelect: () => void;
}) {
	return (
		<button
			className={cn(
				"flex h-11 w-full shrink-0 items-center gap-3 rounded-lg border bg-card px-3.5 text-sm transition-colors",
				selected ? "border-foreground bg-surface-1" : "hover:bg-surface-1",
			)}
			onClick={onSelect}
			type="button"
		>
			<span className="min-w-0 flex-1 truncate text-left font-medium">
				{repo.fullName}
			</span>
			{repo.private ? (
				<span className="shrink-0 rounded-full bg-surface-1 px-2 py-0.5 text-muted-foreground text-xs">
					private
				</span>
			) : null}
			<HugeiconsIcon
				className={cn(
					"shrink-0 transition-opacity",
					selected ? "text-foreground opacity-100" : "opacity-0",
				)}
				icon={CheckmarkCircle02Icon}
				size={16}
				strokeWidth={2}
			/>
		</button>
	);
}

export function OnboardingPageSkeleton() {
	return (
		<div className="flex min-h-dvh flex-col items-center justify-center bg-background px-6">
			<div className="flex w-full max-w-sm flex-col items-center gap-5">
				<div className="size-9 animate-pulse rounded-md bg-surface-1" />
				<div className="h-4 w-52 animate-pulse rounded bg-surface-1" />
				<div className="mt-3 h-9 w-full animate-pulse rounded-md bg-surface-1" />
			</div>
		</div>
	);
}
