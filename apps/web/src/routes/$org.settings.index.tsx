import { createFileRoute, redirect } from "@tanstack/react-router";
import { firstSettingsSection } from "#/lib/settings-sections";

export const Route = createFileRoute("/$org/settings/")({
	beforeLoad: ({ params, context }) => {
		throw redirect({
			to: `/$org/settings/${firstSettingsSection(context.org.permissions)}`,
			params: { org: params.org },
			replace: true,
		});
	},
});
