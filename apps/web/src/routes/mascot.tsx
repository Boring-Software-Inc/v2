import { createFileRoute, notFound } from "@tanstack/react-router";
import { MascotPage } from "#/components/mascot/mascot-page";
import { MascotPageSkeleton } from "#/components/mascot/mascot-page-skeleton";
import { buildSeo, formatPageTitle } from "#/lib/seo";

export const Route = createFileRoute("/mascot")({
	beforeLoad: () => {
		if (!import.meta.env.DEV) {
			throw notFound();
		}
	},
	component: MascotPage,
	pendingComponent: MascotPageSkeleton,
	head: ({ match }) =>
		buildSeo({
			path: match.pathname,
			title: formatPageTitle("Mascot"),
			description: "mascot simulator for design work.",
			noindex: true,
		}),
});
