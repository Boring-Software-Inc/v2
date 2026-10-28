import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { GitCafeConnectionRefusal } from "@tripwire/contracts";
import { Alert, AlertTitle } from "#/components/glaze/ui/alert";
import { Button } from "#/components/glaze/ui/button";
import {
	InstallSetupHeader,
	InstallSetupShell,
} from "#/components/organizations/install-setup-shell";
import { gitCafeConnectionStatusQueryOptions } from "#/lib/gitcafe-connection.query";

const REFUSAL_COPY = {
	"invalid-job":
		"This connection request is incomplete or invalid. Start again from Connect repos.",
	unauthorized:
		"Your Tripwire session or permission to manage connections changed. Sign in and check your org access before trying again.",
	expired:
		"Your GitCafe authorization expired before the repos finished loading. Authorize again to retry.",
	configuration:
		"This Tripwire server isn't configured to connect GitCafe. Contact its admin.",
	"authority-unavailable":
		"GitCafe didn't return complete access details. Try again shortly. If it keeps failing, check the GitCafe app's permissions.",
	"not-admin":
		"Only a GitCafe admin of this installation can connect it. Check which GitCafe account you authorized.",
	"installation-mismatch":
		"The GitCafe installation or repository access changed while connecting. Check the app's repository selection, then authorize again.",
	"repository-mismatch":
		"GitCafe couldn't return a complete, consistent repository list. Check the app's repository access and try again.",
	"repository-conflict":
		"A selected repo has the same name as another repo in this Tripwire org. Change the GitCafe repo selection or connect to a different Tripwire org.",
	"ownership-conflict":
		"This installation or repo has an existing Tripwire connection. Ask your Tripwire server admin to review the conflicting connection.",
	"queue-unavailable":
		"Tripwire couldn't start the connection. Try again shortly.",
} satisfies Record<GitCafeConnectionRefusal, string>;

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
						? REFUSAL_COPY[current.reason]
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
