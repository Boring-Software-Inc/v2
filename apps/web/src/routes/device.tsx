import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { AgentDevicePage } from "#/components/agents/agent-device-page";
import { AgentRequestSkeleton } from "#/components/agents/agent-request-skeleton";
import { buildSeo, formatPageTitle } from "#/lib/seo";

const deviceSearch = z.object({
	user_code: z
		.union([z.string(), z.number()])
		.transform((value) => String(value).trim())
		.pipe(z.string().min(1))
		.optional()
		.catch(undefined),
});

export const Route = createFileRoute("/device")({
	validateSearch: (search) => deviceSearch.parse(search),
	component: AgentDevicePage,
	pendingComponent: AgentRequestSkeleton,
	head: ({ match }) =>
		buildSeo({
			path: match.pathname,
			title: formatPageTitle("Sign in the CLI"),
			description: "Approve a Tripwire CLI sign-in.",
			noindex: true,
		}),
});
