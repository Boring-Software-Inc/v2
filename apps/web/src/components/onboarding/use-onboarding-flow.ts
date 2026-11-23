import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { getRouteApi, useRouter } from "@tanstack/react-router";
import {
	ONBOARDING_STEPS,
	type OnboardingAnswers,
	type OnboardingStep,
	visibleOnboardingSteps,
} from "@tripwire/contracts";
import { notify } from "@tripwire/ui/toast";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { ONBOARDING_COPY } from "#/components/onboarding/onboarding-copy";
import { authQueryKeys } from "#/lib/auth.query";
import {
	finishOnboarding,
	type OnboardingState,
	type SaveOnboardingInput,
	saveOnboardingStep,
} from "#/lib/onboarding-flow.functions";
import {
	onboardingFlowKeys,
	onboardingStateQueryOptions,
} from "#/lib/onboarding-flow.query";

const route = getRouteApi("/onboarding/");

/** +1 when moving forward through the steps, -1 when going back. */
export type StepDirection = 1 | -1;

function stepsFor(state: OnboardingState, answers: OnboardingAnswers) {
	return visibleOnboardingSteps({
		usage: answers.usage,
		hasChangeRequests: state.hasChangeRequests,
		reportedCount: answers.reported.length,
		checkDone:
			ONBOARDING_STEPS.indexOf(state.step) > ONBOARDING_STEPS.indexOf("check"),
	});
}

/**
 * The visible step: the URL's when the user has reached it and it can be
 * shown, else the saved one. A link can go back, never ahead of progress.
 */
function resolveStep(
	wanted: OnboardingStep | undefined,
	saved: OnboardingStep,
	steps: readonly OnboardingStep[],
): OnboardingStep {
	const reached =
		wanted !== undefined &&
		ONBOARDING_STEPS.indexOf(wanted) <= ONBOARDING_STEPS.indexOf(saved);
	const candidate = reached ? wanted : saved;
	if (steps.includes(candidate)) {
		return candidate;
	}
	const at = ONBOARDING_STEPS.indexOf(candidate);
	return (
		steps.find((step) => ONBOARDING_STEPS.indexOf(step) > at) ??
		steps.at(-1) ??
		"welcome"
	);
}

/** Progress only moves forward, as the server saves it. */
function furthest(
	saved: OnboardingStep,
	next: OnboardingStep | undefined,
): OnboardingStep {
	return next &&
		ONBOARDING_STEPS.indexOf(next) > ONBOARDING_STEPS.indexOf(saved)
		? next
		: saved;
}

/**
 * The onboarding state machine. The URL `?step=` is the view, the saved row
 * is progress: moving on navigates first and saves in the background, so the
 * transition never waits on the network.
 */
export function useOnboardingFlow() {
	const queryClient = useQueryClient();
	const router = useRouter();
	const navigate = route.useNavigate();
	const search = route.useSearch();
	const { data: state } = useSuspenseQuery(onboardingStateQueryOptions());
	const steps = useMemo(() => stepsFor(state, state.answers), [state]);
	const step = resolveStep(search.step, state.step, steps);
	const index = steps.indexOf(step);
	const shown = useRef(step);
	const direction = useRef<StepDirection>(1);
	if (shown.current !== step) {
		direction.current =
			ONBOARDING_STEPS.indexOf(step) > ONBOARDING_STEPS.indexOf(shown.current)
				? 1
				: -1;
		shown.current = step;
	}

	// The URL always names the step on screen: a link past progress, or to a
	// step this user skips, is replaced with the one shown.
	useEffect(() => {
		if (search.step !== step) {
			void navigate({ search: { step }, replace: true });
		}
	}, [navigate, search.step, step]);

	const save = useMutation({
		mutationFn: (input: SaveOnboardingInput) =>
			saveOnboardingStep({ data: input }),
		onMutate: (input) => {
			queryClient.setQueryData<OnboardingState>(
				onboardingFlowKeys.state(),
				(current) =>
					current && {
						...current,
						step: furthest(current.step, input.step),
						answers: { ...current.answers, ...input.answers },
					},
			);
		},
		onSuccess: async (result) => {
			if (result.status === "finished") {
				await queryClient.invalidateQueries({
					queryKey: authQueryKeys.session(),
				});
				await router.navigate({ to: "/" });
				return;
			}
			queryClient.setQueryData(onboardingFlowKeys.state(), result.state);
		},
		onError: () => {
			notify.show({ title: ONBOARDING_COPY.saveFailed }, "error");
			void queryClient.invalidateQueries({
				queryKey: onboardingFlowKeys.state(),
			});
		},
	});

	const goTo = useCallback(
		(next: OnboardingStep, input: Omit<SaveOnboardingInput, "step"> = {}) => {
			save.mutate({ ...input, step: next });
			void navigate({ search: { step: next } });
		},
		[navigate, save],
	);

	/** Saves this step's answers and moves to the next step the user will see. */
	const advance = useCallback(
		(input: Omit<SaveOnboardingInput, "step"> = {}) => {
			const answers = { ...state.answers, ...input.answers };
			const upcoming = stepsFor(
				{
					...state,
					step:
						ONBOARDING_STEPS.indexOf(step) >
						ONBOARDING_STEPS.indexOf(state.step)
							? step
							: state.step,
				},
				answers,
			);
			const at = ONBOARDING_STEPS.indexOf(step);
			const next = upcoming.find(
				(candidate) => ONBOARDING_STEPS.indexOf(candidate) > at,
			);
			if (next) {
				goTo(next, input);
			} else {
				save.mutate(input);
			}
		},
		[goTo, save, state, step],
	);

	/** Shows a step already reached, back or forward, without saving anything. */
	const visit = useCallback(
		(target: OnboardingStep) => {
			const reached =
				ONBOARDING_STEPS.indexOf(target) <=
				ONBOARDING_STEPS.indexOf(state.step);
			if (reached && steps.includes(target) && target !== step) {
				void navigate({ search: { step: target } });
			}
		},
		[navigate, state.step, step, steps],
	);

	const back = useCallback(() => {
		const previous = steps[index - 1];
		if (previous) {
			void navigate({ search: { step: previous } });
		}
	}, [index, navigate, steps]);

	const finish = useMutation({
		mutationFn: (outcome: "completed" | "skipped") =>
			finishOnboarding({ data: { outcome } }),
		onSuccess: async ({ to }) => {
			await queryClient.invalidateQueries({
				queryKey: authQueryKeys.session(),
			});
			queryClient.removeQueries({ queryKey: onboardingFlowKeys.all });
			await router.navigate({ href: to });
		},
		onError: () => {
			notify.show({ title: ONBOARDING_COPY.finishFailed }, "error");
		},
	});

	return {
		state,
		step,
		steps,
		index,
		direction: direction.current,
		saving: save.isPending,
		advance,
		goTo,
		back,
		visit,
		save: save.mutate,
		finish: finish.mutate,
		finishing: finish.isPending,
	};
}
