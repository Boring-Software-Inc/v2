import { createFileRoute } from "@tanstack/react-router";
import {
	EventsPage,
	EventsPageSkeleton,
} from "#/components/events/events-page";
import { buildSeo, formatPageTitle } from "#/lib/seo";

export const Route = createFileRoute("/events")({
	component: EventsPage,
	pendingComponent: EventsPageSkeleton,
	head: ({ match }) =>
		buildSeo({
			path: match.pathname,
			title: formatPageTitle("Events"),
			description: "Live feed of ingested forge events.",
			noindex: true,
		}),
});
