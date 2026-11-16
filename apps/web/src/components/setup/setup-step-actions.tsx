import { useQuery } from "@tanstack/react-query";
import type { Forge } from "@tripwire/contracts";
import { Button } from "@tripwire/ui/button";
import {
	useKeepResponseDefaults,
	useRunFirstCheck,
} from "#/components/setup/use-repo-setup";
import { useOrgPermission } from "#/hooks/use-org-permission";
import { orgInstallUrlQueryOptions } from "#/lib/onboarding.query";
import type { SetupStepKey } from "#/lib/repo-setup";
import type { RepoSetupState } from "#/lib/repo-setup.functions";
import { trackEvent } from "#/lib/track";

interface StepActionProps {
	org: string;
	repo: string;
	state: RepoSetupState;
}

export function InstallAction({
	org,
	forge = "github",
}: {
	org: string;
	forge?: Forge;
}) {
	const canInstall = useOrgPermission(org, "connections:manage");
	const install = useQuery({
		...orgInstallUrlQueryOptions(org),
		enabled: canInstall && forge !== "gitcafe",
	});
	if (forge === "gitcafe")
		return (
			<Button
				href={`/${org}/settings/connections`}
				disabled={!canInstall}
				size="small"
			>
				Manage GitCafe connection
			</Button>
		);
	const url = install.data?.status === "ready" ? install.data.url : null;
	return (
		<Button
			disabled={!url}
			onAction={() => {
				if (!url) {
					return;
				}
				trackEvent("github_app_install_started", { forge: "github" });
				window.location.assign(url);
			}}
			pending={canInstall && install.isPending}
			size="small"
		>
			Choose repos on GitHub
		</Button>
	);
}

export function FirstCheckAction({
	org,
	repo,
	state,
	replayLink = true,
}: StepActionProps & { replayLink?: boolean }) {
	const canRun = useOrgPermission(org, "activity:manage");
	const run = useRunFirstCheck(org, repo);
	const number = state.facts.nextChangeRequest;
	return (
		<div data-layout-role="setup-step-actions">
			{number !== null ? (
				<Button
					disabled={!canRun}
					onAction={() => run.mutate(number)}
					pending={run.isPending}
					pendingLabel={`Running rules on #${number}`}
					size="small"
				>
					Run rules on #{number}
				</Button>
			) : null}
			{replayLink ? (
				<Button
					href={`/${org}/${repo}/moderation/replay`}
					size="small"
					variant={number === null ? "primary" : "ghost"}
				>
					View rule replay
				</Button>
			) : null}
		</div>
	);
}

export function ResponsesAction({ org, repo, state }: StepActionProps) {
	const canManage = useOrgPermission(org, "responses:manage");
	const keep = useKeepResponseDefaults(org, repo, state.repoId);
	return (
		<div data-layout-role="setup-step-actions">
			<Button
				disabled={!canManage}
				onAction={() => keep.mutate()}
				pending={keep.isPending}
				pendingLabel="Saving"
				size="small"
				variant="secondary"
			>
				Keep defaults
			</Button>
			<Button href={`/${org}/${repo}/responses`} size="small">
				Open responses
			</Button>
		</div>
	);
}

export function RulesLinkAction({ org, repo }: { org: string; repo: string }) {
	return (
		<Button href={`/${org}/${repo}/rules`} size="small">
			Install rules
		</Button>
	);
}

export function compactStepAction(
	key: SetupStepKey,
	props: StepActionProps,
): React.ReactNode {
	switch (key) {
		case "install":
			return <InstallAction org={props.org} />;
		case "rules":
			return <RulesLinkAction org={props.org} repo={props.repo} />;
		case "check":
			return (
				<FirstCheckAction
					{...props}
					replayLink={props.state.facts.nextChangeRequest === null}
				/>
			);
		case "responses":
			return <ResponsesAction {...props} />;
	}
}
