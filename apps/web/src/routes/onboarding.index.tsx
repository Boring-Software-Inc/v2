import { createFileRoute, redirect } from "@tanstack/react-router";
import { ONBOARDING_STEPS } from "@tripwire/contracts";
import { OnboardingPage } from "#/components/onboarding/onboarding-page";
import { OnboardingPageSkeleton } from "#/components/onboarding/onboarding-page-skeleton";
import {
	currentUserQueryOptions,
	sessionInfoQueryOptions,
} from "#/lib/auth.query";
import {
	onboardingStateQueryOptions,
	onboardingWorkflowQueryOptions,
} from "#/lib/onboarding-flow.query";
import { onboardingSearchSchema } from "#/lib/onboarding-search";
import { orgHomeQueryOptions } from "#/lib/org.query";
import { buildSeo, formatPageTitle } from "#/lib/seo";

export const Route = createFileRoute("/onboarding/")({
	validateSearch: onboardingSearchSchema,
	beforeLoad: async ({ context }) => {
		const session = await context.queryClient.ensureQueryData(
			sessionInfoQueryOptions(),
		);
		if (!session.onboardingRequired) {
			throw redirect({ to: "/" });
		}
	},
	// What the first paint of a resumed step depends on loads with the route:
	// the user (the previews' rail and account menu), whether the workspace
	// has its forge app (the Connect step's phase), and the drafted workflow
	// once there is one to draft. Otherwise those steps open on a guess and
	// correct themselves a moment later.
	loader: async ({ context }) => {
		const [state] = await Promise.all([
			context.queryClient.ensureQueryData(onboardingStateQueryOptions()),
			context.queryClient.ensureQueryData(currentUserQueryOptions()),
		]);
		const org = state.orgSlug ?? state.personalOrgSlug;
		const reached = ONBOARDING_STEPS.indexOf(state.step);
		await Promise.all([
			org && reached >= ONBOARDING_STEPS.indexOf("connect")
				? context.queryClient.ensureQueryData(orgHomeQueryOptions(org))
				: null,
			org &&
			state.repo &&
			state.answers.reported.length > 0 &&
			reached >= ONBOARDING_STEPS.indexOf("workflow")
				? context.queryClient.ensureQueryData(
						onboardingWorkflowQueryOptions(
							org,
							state.repo.id,
							state.answers.reported,
						),
					)
				: null,
		]);
	},
	component: OnboardingPage,
	pendingComponent: OnboardingPageSkeleton,
	head: ({ match }) =>
		buildSeo({
			path: match.pathname,
			title: formatPageTitle("Welcome"),
			description: "Set up Tripwire for your repos.",
			noindex: true,
		}),
});
