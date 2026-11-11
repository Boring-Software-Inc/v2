import { getRouteApi } from "@tanstack/react-router";
import { AppealPage } from "#/components/appeals/appeal-page";
import { AppealPortalPage } from "#/components/appeals/appeal-portal-page";

const route = getRouteApi("/appeals/$target");

export function AppealsPage() {
	const data = route.useLoaderData();
	return data.kind === "case" ? (
		<AppealPage key={data.runId} runId={data.runId} />
	) : (
		<AppealPortalPage key={data.org} org={data.org} />
	);
}
