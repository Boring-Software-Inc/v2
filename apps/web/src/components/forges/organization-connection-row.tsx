import {
	FORGE_BY_ID,
	type OrganizationForgeConnection,
} from "@tripwire/contracts";
import { Button } from "@tripwire/ui/button";
import { Collapsible } from "@tripwire/ui/collapsible";
import { Dialog } from "@tripwire/ui/dialog";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemGroup,
	ItemTitle,
} from "@tripwire/ui/item";
import { forgeInstallationSettingsUrl } from "@tripwire/utils/forge-sign-in";
import { useState } from "react";
import { ForgeMark } from "#/components/common/forge-marks";
import { GitCafeRepositorySelection } from "#/components/forges/gitcafe-repository-selection";

type ConnectionRepository = OrganizationForgeConnection["repositories"][number];
export function OrganizationConnectionRow({
	org,
	connection,
	onCheckAccess,
}: {
	org: string;
	connection: OrganizationForgeConnection;
	onCheckAccess: () => Promise<unknown>;
}) {
	const label = FORGE_BY_ID[connection.forge].label;
	const [selection, setSelection] = useState<{
		repo: ConnectionRepository;
		href: string;
	} | null>(null);
	const [waiting, setWaiting] = useState<ConnectionRepository | null>(null);
	const [checking, setChecking] = useState(false);
	const [checkFailed, setCheckFailed] = useState(false);
	const stillConnected =
		waiting && connection.repositories.some((repo) => repo.id === waiting.id);
	return (
		<Collapsible
			disabled={
				connection.repositories.length === 0 &&
				(connection.forge !== "gitcafe" ||
					connection.installations.length === 0)
			}
			hiddenUntilFound
			summary={`${connection.repositories.length} ${connection.repositories.length === 1 ? "repo" : "repos"}`}
			trigger={
				<span className="inline-flex items-center composition-gap-standard">
					<ForgeMark
						className="size-(--icon) shrink-0"
						forge={connection.forge}
					/>
					{label}
				</span>
			}
		>
			{connection.forge === "gitcafe" && connection.installations.length > 0 ? (
				<div className="composition-bottom-section">
					<GitCafeRepositorySelection
						installations={connection.installations}
						repositories={connection.repositories}
						org={org}
					/>
				</div>
			) : null}
			<ItemGroup aria-label={`${label} repositories`} variant="plain">
				{connection.repositories.map((repo) => {
					const installation = connection.installations.find(
						(item) => item.installationId === repo.installationId,
					);
					const href = forgeInstallationSettingsUrl(
						connection.forge,
						installation,
					);
					return (
						<Item key={repo.id}>
							<ItemContent>
								<ItemTitle data-layout-role="connection-repo-title">
									{repo.fullName}
								</ItemTitle>
							</ItemContent>
							{href ? (
								<ItemActions>
									<Button
										ariaLabel={`Disconnect ${repo.fullName} from ${label}`}
										onAction={() => setSelection({ repo, href })}
										size="small"
										variant="secondary"
									>
										Disconnect
									</Button>
								</ItemActions>
							) : null}
						</Item>
					);
				})}
			</ItemGroup>
			{connection.repositories.length === 0 ? (
				<p className="content-body-small tone-content-secondary">
					No repositories connected.
				</p>
			) : null}
			{waiting ? (
				<div className="flex flex-wrap items-center composition-gap-standard connection-access-inset">
					<output className="min-w-0 content-body-small tone-content-secondary wrap-anywhere">
						{checkFailed
							? "Couldn't check access. Try again."
							: stillConnected
								? `Remove ${waiting.fullName} on ${label}, then refresh access here.`
								: `${waiting.fullName} disconnected from ${label}.`}
					</output>
					{stillConnected ? (
						<Button
							disabled={checking}
							onAction={async () => {
								setChecking(true);
								setCheckFailed(false);
								try {
									await onCheckAccess();
								} catch {
									setCheckFailed(true);
								} finally {
									setChecking(false);
								}
							}}
							size="small"
							variant="secondary"
						>
							{checking ? "Checking access" : "Refresh access"}
						</Button>
					) : null}
				</div>
			) : null}
			<Dialog
				action={
					selection
						? {
								href: selection.href,
								label: `Continue on ${label}`,
								onNavigate: (href) => {
									setWaiting(selection.repo);
									setSelection(null);
									window.open(href, "_blank", "noopener,noreferrer");
								},
								openInNewTab: true,
							}
						: undefined
				}
				description={
					<>
						Remove {selection?.repo.fullName} from Tripwire's installation on{" "}
						{label}. This page updates after {label} confirms the change.
					</>
				}
				open={selection !== null}
				onOpenChange={(open) => {
					if (!open) setSelection(null);
				}}
				title={`Remove repository access on ${label}`}
			>
				<p className="content-body-small tone-content-secondary">
					Keep the app installed for the other repositories. Run history stays
					in Tripwire.
				</p>
			</Dialog>
		</Collapsible>
	);
}
