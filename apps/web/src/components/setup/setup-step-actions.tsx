import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Button } from "#/components/glaze/ui/button";
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

export function InstallAction({ org }: { org: string }) {
	const canInstall = useOrgPermission(org, "connections:manage");
	const install = useQuery({
		...orgInstallUrlQueryOptions(org),
		enabled: canInstall,
	});
	const url = install.data?.status === "ready" ? install.data.url : null;
	return (
		<Button
			disabled={!url}
			onClick={() => {
				if (!url) {
					return;
				}
				trackEvent("github_app_install_started", { forge: "github" });
				window.location.assign(url);
			}}
			pending={canInstall && install.isPending}
			size="sm"
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
		<div className="flex flex-wrap items-center gap-2">
			{number !== null ? (
				<Button
					disabled={!canRun}
					onClick={() => run.mutate(number)}
					pending={run.isPending}
					pendingLabel={`Running rules on #${number}`}
					size="sm"
				>
					Run rules on #{number}
				</Button>
			) : null}
			{replayLink ? (
				<Button
					nativeButton={false}
					render={
						<Link params={{ org, repo }} to="/$org/$repo/moderation/replay" />
					}
					size="sm"
					variant={number === null ? "primary" : "ghost"}
				>
					While your rules were off
				</Button>
			) : null}
		</div>
	);
}

export function ResponsesAction({ org, repo, state }: StepActionProps) {
	const canManage = useOrgPermission(org, "responses:manage");
	const keep = useKeepResponseDefaults(org, repo, state.repoId);
	return (
		<div className="flex flex-wrap items-center gap-2">
			<Button
				disabled={!canManage}
				onClick={() => keep.mutate()}
				pending={keep.isPending}
				pendingLabel="Saving"
				size="sm"
				variant="secondary"
			>
				Keep defaults
			</Button>
			<Button
				nativeButton={false}
				render={<Link params={{ org, repo }} to="/$org/$repo/responses" />}
				size="sm"
			>
				Open Responses
			</Button>
		</div>
	);
}

export function RulesLinkAction({ org, repo }: { org: string; repo: string }) {
	return (
		<Button
			nativeButton={false}
			render={<Link params={{ org, repo }} to="/$org/$repo/rules" />}
			size="sm"
		>
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
