import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { toast } from "#/components/glaze/ui/toast";
import { useInstallRules } from "#/components/rules/use-install-rules";
import { useOrgPermission } from "#/hooks/use-org-permission";
import { rerunChangeRequest } from "#/lib/activity.functions";
import { armRepo } from "#/lib/arm.functions";
import { onboardingDue, setupProgress } from "#/lib/repo-setup";
import {
	claimOnboardingEvent,
	keepResponseDefaults,
	type OnboardingEvent,
	takeOverAgentSetup,
} from "#/lib/repo-setup.functions";
import {
	repoSetupQueryKeys,
	repoSetupQueryOptions,
} from "#/lib/repo-setup.query";
import { responseQueryKeys } from "#/lib/response.query";
import { trackEvent } from "#/lib/track";

export function useRepoSetup(org: string, repo: string) {
	const query = useQuery(repoSetupQueryOptions(org, repo));
	const state = query.data ?? null;
	return {
		query,
		state,
		progress: state ? setupProgress(state.facts, state.forge) : null,
	};
}

const ONBOARDING_EVENTS = {
	started: "onboarding_started",
	completed: "onboarding_completed",
} as const;

export function useOnboardingEvents(org: string, repo: string) {
	const { state, progress } = useRepoSetup(org, repo);
	const canClaim = useOrgPermission(org, "connections:manage");
	const invalidate = useInvalidateRepoSetup(org, repo);
	const { mutate } = useMutation({
		mutationFn: (input: { repoId: string; event: OnboardingEvent }) =>
			claimOnboardingEvent({ data: { org, ...input } }),
		onSuccess: ({ claimed }, { event }) => {
			if (claimed) {
				trackEvent(ONBOARDING_EVENTS[event], {});
			}
		},
		onSettled: invalidate,
	});
	const due =
		canClaim && state && state.forge !== "gitcafe" && progress
			? onboardingDue(state.facts, progress)
			: null;
	const repoId = state?.repoId ?? null;
	useEffect(() => {
		if (due && repoId) {
			mutate({ repoId, event: due });
		}
	}, [due, repoId, mutate]);
}

export function useInvalidateRepoSetup(org: string, repo: string) {
	const queryClient = useQueryClient();
	return () =>
		queryClient.invalidateQueries({
			queryKey: repoSetupQueryKeys.detail(org, repo),
		});
}

export function useRunFirstCheck(org: string, repo: string) {
	const invalidate = useInvalidateRepoSetup(org, repo);
	return useMutation({
		mutationFn: (number: number) =>
			rerunChangeRequest({ data: { org, repo, number } }),
		onSuccess: (result, number) => {
			if (result.status === "queued") {
				toast(`Running rules on #${number}`);
				return;
			}
			if (result.status === "cooldown") {
				toast(
					`You can run rules on #${number} again in about ${Math.max(1, Math.ceil(result.retryInSeconds / 60))} min`,
				);
				return;
			}
			toast.fail(
				result.status === "no-event"
					? `Tripwire has nothing to check on #${number} yet.`
					: "Install rules first.",
			);
		},
		onError: () => toast.fail("Tripwire could not run rules. Try again."),
		onSettled: invalidate,
	});
}

export function useKeepResponseDefaults(
	org: string,
	repo: string,
	repoId: string,
) {
	const queryClient = useQueryClient();
	const invalidate = useInvalidateRepoSetup(org, repo);
	return useMutation({
		mutationFn: () => keepResponseDefaults({ data: { org, repoId } }),
		onError: () => toast.fail("Tripwire could not save. Try again."),
		onSettled: async () => {
			await Promise.all([
				invalidate(),
				queryClient.invalidateQueries({
					queryKey: responseQueryKeys.config(org, repoId),
				}),
			]);
		},
	});
}

export function useTakeOver(org: string, repo: string) {
	const invalidate = useInvalidateRepoSetup(org, repo);
	return useMutation({
		mutationFn: (code: string) => takeOverAgentSetup({ data: { org, code } }),
		onError: () => toast.fail("Tripwire could not take over. Try again."),
		onSettled: invalidate,
	});
}

export function useSetupInstallRules(input: {
	org: string;
	repo: string;
	repoId: string;
	armed: boolean;
}) {
	const invalidate = useInvalidateRepoSetup(input.org, input.repo);
	return useInstallRules(input.org, input.repoId, {
		prepare: async () => {
			if (input.armed) {
				return null;
			}
			try {
				const result = await armRepo({
					data: { org: input.org, repo: input.repo },
				});
				if (result.armed) return null;
				return !result.ok && result.reason === "queue-unavailable"
					? "Tripwire did not turn on. Try again in a moment."
					: "Tripwire did not turn on. Try again.";
			} catch {
				return "Only an org admin can turn on Tripwire for this repo.";
			}
		},
		onDone: () => {
			void invalidate();
		},
	});
}
