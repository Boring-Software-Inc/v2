/** biome-ignore assist/source/organizeImports: AGENTS requires React, external packages, lib, then feature imports. */
import { useId } from "react";

import { useMutation, useQuery } from "@tanstack/react-query";
import type { OrganizationForgeConnection } from "@tripwire/contracts";
import { forgeInstallationSettingsUrl } from "@tripwire/utils/forge-sign-in";

import { providerAvailabilityQueryOptions } from "#/lib/auth.query";
import { startGitCafeConnection } from "#/lib/gitcafe-connection.functions";

import { Alert, AlertTitle } from "#/components/glaze/ui/alert";
import { Button } from "#/components/glaze/ui/button";

/** Selection changes reuse the person-bound connection proof and complete worker discovery. */
export function GitCafeRepositorySelection({
	org,
	installations,
}: {
	org: string;
	installations: OrganizationForgeConnection["installations"];
}) {
	const providers = useQuery(providerAvailabilityQueryOptions());
	const reasonId = useId();
	const availabilityReason = providers.isPending
		? "Checking repository sync availability."
		: providers.isError
			? "Couldn't check repository sync availability. Refresh the page to try again."
			: !providers.data.available.includes("gitcafe")
				? "GitCafe repository sync isn't available on this Tripwire server."
				: null;
	const sync = useMutation({
		mutationFn: (installationId: string) =>
			startGitCafeConnection({ data: { org, installationId } }),
		onSuccess: (result) => window.location.assign(result.url),
	});
	return (
		<div className="flex min-w-0 flex-col gap-3">
			<p className="type-body-sm text-text-2">
				Change repository access on GitCafe, then sync the selection here.
				GitCafe will ask you to authorize access before Tripwire loads the
				repos.
			</p>
			{installations.map((installation) => {
				const href = forgeInstallationSettingsUrl("gitcafe", installation);
				if (!href) return null;
				return (
					<div
						className="flex min-w-0 flex-wrap items-center gap-2"
						key={installation.installationId}
					>
						<span className="me-auto min-w-0 type-label wrap-anywhere">
							{installation.owner}
						</span>
						<Button
							nativeButton={false}
							render={
								<a
									aria-label={`Manage repositories for ${installation.owner} on GitCafe (opens in a new tab)`}
									href={href}
									target="_blank"
									rel="noopener noreferrer"
								>
									Manage repositories on GitCafe
								</a>
							}
							variant="secondary"
						/>
						<Button
							aria-describedby={availabilityReason ? reasonId : undefined}
							aria-label={`Sync GitCafe repositories for ${installation.owner}`}
							disabled={availabilityReason !== null || sync.isPending}
							onClick={() => sync.mutate(installation.installationId)}
							pending={
								sync.isPending && sync.variables === installation.installationId
							}
							pendingLabel="Opening GitCafe"
						>
							Sync repositories
						</Button>
					</div>
				);
			})}
			{availabilityReason ? (
				<output className="type-body-sm text-text-2" id={reasonId}>
					{availabilityReason}
				</output>
			) : null}
			{sync.isError ? (
				<Alert status="fail">
					<AlertTitle>
						Couldn't start repository sync. Check your connection and try again.
					</AlertTitle>
				</Alert>
			) : null}
		</div>
	);
}
