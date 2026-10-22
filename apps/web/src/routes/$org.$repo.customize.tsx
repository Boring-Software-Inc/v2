import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/$org/$repo/customize")({
	beforeLoad: ({ params }) => {
		throw redirect({ to: "/$org/$repo/responses", params, replace: true });
	},
});
