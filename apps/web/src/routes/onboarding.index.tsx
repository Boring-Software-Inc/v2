import { createFileRoute, redirect } from "@tanstack/react-router";
import { OnboardingPage } from "#/components/onboarding/onboarding-page";
import { OnboardingPageSkeleton } from "#/components/onboarding/onboarding-page-skeleton";
import {
	currentUserQueryOptions,
	sessionInfoQueryOptions,
} from "#/lib/auth.query";
import { onboardingStateQueryOptions } from "#/lib/onboarding-flow.query";
import { onboardingSearchSchema } from "#/lib/onboarding-search";
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
	// The signed-in user too: the previews show them in the rail and the
	// account menu from the first paint.
	loader: ({ context }) =>
		Promise.all([
			context.queryClient.ensureQueryData(onboardingStateQueryOptions()),
			context.queryClient.ensureQueryData(currentUserQueryOptions()),
		]),
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
