import { getRouteApi, Outlet } from "@tanstack/react-router";
import { useOnboardingEvents } from "#/components/setup/use-repo-setup";

const routeApi = getRouteApi("/$org/$repo");

export function RepoLayout() {
	const { org, repo } = routeApi.useParams();
	useOnboardingEvents(org, repo);
	return <Outlet />;
}
