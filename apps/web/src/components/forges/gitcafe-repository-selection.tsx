/** biome-ignore assist/source/organizeImports: AGENTS requires React, external packages, lib, then feature imports. */
import { useId, useMemo } from "react";

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
	repositories,
}: {
	org: string;
	installations: OrganizationForgeConnection["installations"];
	repositories: OrganizationForgeConnection["repositories"];
}) {
	const providers = useQuery(providerAvailabilityQueryOptions());
	const reasonId = useId();
	const repositoryCounts = useMemo(() => {
		const counts = new Map<string, number>();
		for (const repo of repositories)
			counts.set(
				repo.installationId,
				(counts.get(repo.installationId) ?? 0) + 1,
			);
		return counts;
	}, [repositories]);
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
				const count = repositoryCounts.get(installation.installationId) ?? 0;
				const label =
					installations.length > 1
						? `${installation.owner}, ${count} connected ${count === 1 ? "repo" : "repos"}`
						: installation.owner;
				return (
					<div
						className="flex min-w-0 flex-wrap items-center gap-2"
						key={installation.installationId}
					>
						<span className="me-auto flex min-w-0 flex-col gap-0.5 type-label wrap-anywhere">
							{installation.owner}
							{installations.length > 1 ? (
								<span className="type-caption text-text-2">
									{count} connected {count === 1 ? "repo" : "repos"}
								</span>
							) : null}
						</span>
						<Button
							nativeButton={false}
							render={
								<a
									aria-label={`Manage repositories for ${label} on GitCafe (opens in a new tab)`}
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
							aria-label={`Sync GitCafe repositories for ${label}`}
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
