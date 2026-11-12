import { getRouteApi } from "@tanstack/react-router";
import { AppealPage } from "#/components/appeals/appeal-page";
import { AppealPortalPage } from "#/components/appeals/appeal-portal-page";

const route = getRouteApi("/appeals/$target");

export function AppealsPage() {
	const data = route.useLoaderData();
	const { preview } = route.useSearch();
	return data.kind === "case" ? (
		<AppealPage key={data.runId} runId={data.runId} />
	) : (
		<AppealPortalPage
			key={`${data.org}:${preview ?? "admin"}`}
			org={data.org}
			preview={preview === "public"}
		/>
	);
}
