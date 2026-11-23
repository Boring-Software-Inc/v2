import { createFileRoute, redirect } from "@tanstack/react-router";
import { OnboardingPage } from "#/components/onboarding/onboarding-page";
import { OnboardingPageSkeleton } from "#/components/onboarding/onboarding-page-skeleton";
import { sessionInfoQueryOptions } from "#/lib/auth.query";
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
	loader: ({ context }) =>
		context.queryClient.ensureQueryData(onboardingStateQueryOptions()),
	component: OnboardingPage,
	pendingComponent: OnboardingPageSkeleton,
	head: ({ match }) =>
		buildSeo({
			path: match.pathname,
			title: formatPageTitle("Welcome to Tripwire"),
			description: "Set up Tripwire for your repos.",
			noindex: true,
		}),
});
