import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import type { SetupSearch } from "@tripwire/contracts";
import { useState } from "react";
import { ForgeMark } from "#/components/common/forge-marks";
import { Alert, AlertTitle } from "#/components/glaze/ui/alert";
import { Button } from "#/components/glaze/ui/button";
import { Card, CardContent } from "#/components/glaze/ui/card";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "#/components/glaze/ui/item";
import { GitCafeConnectionProgress } from "#/components/organizations/gitcafe-connection-progress";
import { InstallSetupPageSkeleton } from "#/components/organizations/install-setup-page-skeleton";
import {
	InstallSetupHeader,
	InstallSetupShell,
} from "#/components/organizations/install-setup-shell";
import { OrgAvatar } from "#/components/organizations/org-avatar";
import {
	confirmGitCafeConnection,
	startGitCafeConnection,
} from "#/lib/gitcafe-connection.functions";
import { gitCafeSetupContextQueryOptions } from "#/lib/gitcafe-connection.query";

export function GitCafeInstallSetup({ search }: { search: SetupSearch }) {
	if (!search.installation_id)
		return (
			<InstallSetupShell>
				<InstallSetupHeader
					title="Choose a GitCafe installation"
					body="Open Connect repos in your Tripwire org and install the app on GitCafe. GitCafe must return the installation ID before you can connect it."
				/>
				<Button
					nativeButton={false}
					render={<Link to="/" />}
					variant="secondary"
				>
					Back home
				</Button>
			</InstallSetupShell>
		);
	return (
		<GitCafeSetupFlow
			key={search.installation_id}
			installationId={search.installation_id}
			search={search}
		/>
	);
}

function GitCafeSetupFlow({
	installationId,
	search,
}: {
	installationId: string;
	search: SetupSearch;
}) {
	const setup = useQuery(
		gitCafeSetupContextQueryOptions(installationId, search.state, search.org),
	);
	const [chosenOrg, setChosenOrg] = useState<string | null>(null);
	if (setup.isError)
		return (
			<InstallSetupShell>
				<InstallSetupHeader
					title="Couldn't load your orgs"
					body="Your session or org access may have changed. Check your connection and try again."
				/>
				<Button onClick={() => void setup.refetch()}>Try again</Button>
			</InstallSetupShell>
		);
	if (!setup.data) return <InstallSetupPageSkeleton />;
	const orgs = setup.data.orgs;
	const selected = orgs.find(
		(org) => org.slug === (chosenOrg ?? setup.data.suggestedOrg),
	);
	if (selected)
		return (
			<GitCafeConfirmation
				installationId={installationId}
				onChangeOrg={() => setChosenOrg("")}
				org={selected}
				search={search}
			/>
		);
	return (
		<InstallSetupShell>
			<InstallSetupHeader
				title="Choose an org for this installation"
				body="Only orgs where you can manage connections are listed. You'll authorize GitCafe access before confirming the connection."
			/>
			<Card>
				<CardContent flush>
					<ItemGroup aria-label="Your orgs" variant="plain">
						{orgs.map((org) => (
							<Item key={org.id}>
								<ItemMedia>
									<OrgAvatar name={org.name} size="sm" />
								</ItemMedia>
								<ItemContent>
									<ItemTitle>{org.name}</ItemTitle>
								</ItemContent>
								<ItemActions>
									<Button
										aria-label={`Choose ${org.name}`}
										onClick={() => setChosenOrg(org.slug)}
										size="sm"
										variant="secondary"
									>
										Choose
									</Button>
								</ItemActions>
							</Item>
						))}
						{orgs.length === 0 ? (
							<p className="p-3 type-body-sm text-text-2">
								You don't have permission to manage connections in an org. Ask
								an org admin to connect this installation.
							</p>
						) : null}
					</ItemGroup>
				</CardContent>
			</Card>
		</InstallSetupShell>
	);
}

function GitCafeConfirmation({
	installationId,
	org,
	search,
	onChangeOrg,
}: {
	installationId: string;
	org: { id: string; slug: string; name: string };
	search: SetupSearch;
	onChangeOrg: () => void;
}) {
	const navigate = useNavigate();
	const proofHandle = search.org === org.id ? search.proofHandle : undefined;
	const start = useMutation({
		mutationFn: () =>
			startGitCafeConnection({ data: { org: org.slug, installationId } }),
		onSuccess: (result) => window.location.assign(result.url),
	});
	const confirm = useMutation({
		mutationFn: () =>
			confirmGitCafeConnection({
				data: { org: org.slug, installationId, proofHandle: proofHandle ?? "" },
			}),
		onSuccess: (result) => {
			if (result.ok)
				void navigate({
					to: "/onboarding/setup",
					replace: true,
					search: {
						forge: "gitcafe",
						installation_id: installationId,
						org: org.id,
						jobId: result.jobId,
					},
				});
		},
	});
	if (search.jobId && search.org === org.id)
		return (
			<GitCafeConnectionProgress
				installationId={installationId}
				jobId={search.jobId}
				org={org}
				onRetry={() => void start.mutate()}
				retryPending={start.isPending}
				retryError={start.error}
			/>
		);
	const refused = confirm.data && !confirm.data.ok;
	const error = start.error ?? confirm.error;
	return (
		<InstallSetupShell>
			<InstallSetupHeader
				title={
					proofHandle
						? `Connect GitCafe to ${org.name}?`
						: "Authorize GitCafe access"
				}
				body={
					proofHandle
						? "Confirm this installation and Tripwire org. Tripwire will verify your current GitCafe admin access and load the selected repos with protection off."
						: "Continue to GitCafe to approve repository metadata access for this connection. Your Tripwire sign-in stays the same. You confirm the org when you return."
				}
			/>
			<Card>
				<CardContent flush>
					<ItemGroup aria-label="Connection" variant="plain">
						<Item>
							<ItemMedia>
								<ForgeMark className="size-5" forge="gitcafe" />
							</ItemMedia>
							<ItemContent>
								<ItemTitle>GitCafe installation</ItemTitle>
								<ItemDescription>
									<span className="break-all">{installationId}</span>
								</ItemDescription>
							</ItemContent>
						</Item>
						<Item>
							<ItemMedia>
								<OrgAvatar name={org.name} size="sm" />
							</ItemMedia>
							<ItemContent>
								<ItemTitle>{org.name}</ItemTitle>
								<ItemDescription>Tripwire org</ItemDescription>
							</ItemContent>
						</Item>
					</ItemGroup>
				</CardContent>
			</Card>
			<div className="flex flex-wrap justify-end gap-2">
				<Button
					disabled={start.isPending || confirm.isPending}
					onClick={onChangeOrg}
					variant="secondary"
				>
					Choose a different org
				</Button>
				{proofHandle && !refused ? (
					<Button
						onClick={() => confirm.mutate()}
						pending={confirm.isPending}
						pendingLabel="Confirming"
					>{`Connect to ${org.name}`}</Button>
				) : (
					<Button
						onClick={() => start.mutate()}
						pending={start.isPending}
						pendingLabel="Opening GitCafe"
					>
						{refused || search.connect_error
							? "Authorize again on GitCafe"
							: "Continue to GitCafe"}
					</Button>
				)}
			</div>
			{refused ? (
				<Alert status="fail">
					<AlertTitle>
						Connection wasn't confirmed. Authorize again to retry with your
						current GitCafe and Tripwire access.
					</AlertTitle>
				</Alert>
			) : null}
			{search.connect_error ? (
				<Alert status="fail">
					<AlertTitle>
						GitCafe authorization wasn't completed. You can try again.
					</AlertTitle>
				</Alert>
			) : null}
			{error ? (
				<Alert status="fail">
					<AlertTitle>
						{error.message || "Couldn't authorize this connection. Try again."}
					</AlertTitle>
				</Alert>
			) : null}
		</InstallSetupShell>
	);
}
