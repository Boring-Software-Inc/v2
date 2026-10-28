import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Alert, AlertTitle } from "#/components/glaze/ui/alert";
import { Button } from "#/components/glaze/ui/button";
import {
	InstallSetupHeader,
	InstallSetupShell,
} from "#/components/organizations/install-setup-shell";
import { gitCafeConnectionStatusQueryOptions } from "#/lib/gitcafe-connection.query";

export function GitCafeConnectionProgress({
	installationId,
	jobId,
	org,
	onRetry,
	retryPending,
	retryError,
}: {
	installationId: string;
	jobId: string;
	org: { name: string; slug: string };
	onRetry: () => void;
	retryPending: boolean;
	retryError: Error | null;
}) {
	const status = useQuery({
		...gitCafeConnectionStatusQueryOptions(org.slug, installationId, jobId),
		refetchInterval: (query) =>
			query.state.data?.status === "pending" ? 2000 : false,
	});
	const current = status.isError ? undefined : status.data;
	if (current?.status === "connected")
		return (
			<InstallSetupShell>
				<InstallSetupHeader
					title={`GitCafe connected to ${org.name}`}
					body={`${current.repoCount} ${current.repoCount === 1 ? "repo is" : "repos are"} connected with protection off. GitCafe checks aren't available yet.`}
				/>
				<Button
					nativeButton={false}
					render={<Link to="/$org/home" params={{ org: org.slug }} />}
				>
					Open repos
				</Button>
			</InstallSetupShell>
		);
	if (status.isPending || current?.status === "pending")
		return (
			<InstallSetupShell>
				<InstallSetupHeader
					title="Checking your GitCafe installation…"
					body="Tripwire is verifying admin access and loading the selected repos. Protection stays off."
				/>
				<output className="type-body-sm text-text-2">Connection pending</output>
			</InstallSetupShell>
		);
	return (
		<InstallSetupShell>
			<InstallSetupHeader
				title={
					current?.status === "refused"
						? "Can't connect this installation"
						: "Couldn't finish the connection"
				}
				body={
					current?.status === "refused"
						? current.reason === "not-admin"
							? "Only a GitCafe admin of this installation can connect it. Check which GitCafe account you authorized."
							: current.reason === "unauthorized"
								? "Your Tripwire session or permission to manage connections changed. Sign in and check your org access before trying again."
								: current.reason === "ownership-conflict"
									? "This installation is connected to another org. Ask an admin of that org to manage the connection."
									: current.reason === "repository-conflict"
										? "A selected repo has the same name as another repo in this Tripwire org. Change the GitCafe repo selection or connect to a different Tripwire org."
										: "Tripwire couldn't verify this installation with your current access. Authorize again to retry, or check with whoever runs this Tripwire server."
						: "The connection couldn't be verified. Authorize again to retry with fresh access."
				}
			/>
			<div className="flex flex-wrap justify-end gap-2">
				<Button onClick={() => void status.refetch()} variant="secondary">
					Check again
				</Button>
				<Button
					onClick={onRetry}
					pending={retryPending}
					pendingLabel="Opening GitCafe"
				>
					Authorize again on GitCafe
				</Button>
			</div>
			{retryError ? (
				<Alert status="fail">
					<AlertTitle>{retryError.message}</AlertTitle>
				</Alert>
			) : null}
			{status.isError ? (
				<Alert status="fail">
					<AlertTitle>
						Couldn't read connection progress. Check your connection and try
						again.
					</AlertTitle>
				</Alert>
			) : null}
		</InstallSetupShell>
	);
}
