import { getRouteApi, Outlet, useBlocker } from "@tanstack/react-router";
import { useCallback } from "react";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { SettingsFrame } from "#/components/settings/settings-frame";
import { SettingsNav } from "#/components/settings/settings-nav";

const orgRoute = getRouteApi("/$org");

export function shouldAnimateSettingsExit(
	currentPathname: string,
	nextPathname: string,
	settingsPath: string,
) {
	const isSettingsPath = (pathname: string) =>
		pathname === settingsPath || pathname.startsWith(`${settingsPath}/`);
	return isSettingsPath(currentPathname) && !isSettingsPath(nextPathname);
}

export function SettingsLayout() {
	const { org } = orgRoute.useParams();
	const settingsPath = `/${org}/settings`;
	const leave = useBlocker({
		shouldBlockFn: ({ current, next }) =>
			shouldAnimateSettingsExit(current.pathname, next.pathname, settingsPath),
		enableBeforeUnload: false,
		withResolver: true,
	});
	const leavingSettings = leave.status === "blocked";
	const finishSecondaryExit = useCallback(() => {
		if (leave.status === "blocked") {
			leave.proceed();
		}
	}, [leave]);
	return (
		<DashboardLayout
			counts={{}}
			onSecondarySidebarExitComplete={finishSecondaryExit}
			secondarySidebar={
				leavingSettings ? undefined : <SettingsNav org={org} variant="rail" />
			}
		>
			<SettingsFrame nav={<SettingsNav org={org} />}>
				<Outlet />
			</SettingsFrame>
		</DashboardLayout>
	);
}
