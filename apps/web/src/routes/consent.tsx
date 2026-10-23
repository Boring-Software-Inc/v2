import { createFileRoute } from "@tanstack/react-router";
import { AgentConsentPage } from "#/components/agents/agent-consent-page";
import { AgentRequestSkeleton } from "#/components/agents/agent-request-skeleton";
import { buildSeo, formatPageTitle } from "#/lib/seo";

export const Route = createFileRoute("/consent")({
	component: AgentConsentPage,
	pendingComponent: AgentRequestSkeleton,
	head: ({ match }) =>
		buildSeo({
			path: match.pathname,
			title: formatPageTitle("Connect an agent"),
			description: "Choose what an agent may do in Tripwire.",
			noindex: true,
		}),
});
