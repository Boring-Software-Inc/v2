import { createFileRoute } from "@tanstack/react-router";
import { QueuePage } from "#/components/auth/queue-page";
import { buildSeo, formatPageTitle } from "#/lib/seo";

export const Route = createFileRoute("/queue")({
	component: QueuePage,
	head: ({ match }) =>
		buildSeo({
			path: match.pathname,
			title: formatPageTitle("Waitlist"),
			description: "Your Tripwire access request status.",
			noindex: true,
		}),
});
