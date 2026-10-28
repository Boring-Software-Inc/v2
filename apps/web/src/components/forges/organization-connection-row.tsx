import {
	FORGE_BY_ID,
	type OrganizationForgeConnection,
} from "@tripwire/contracts";
import { forgeInstallationSettingsUrl } from "@tripwire/utils/forge-sign-in";
import { useState } from "react";
import { ForgeMark } from "#/components/common/forge-marks";
import { GitCafeRepositorySelection } from "#/components/forges/gitcafe-repository-selection";
import { Button } from "#/components/glaze/ui/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#/components/glaze/ui/collapsible";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/glaze/ui/dialog";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemGroup,
	ItemTitle,
} from "#/components/glaze/ui/item";

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
			value={connection.forge}
		>
			<CollapsibleTrigger
				summary={`${connection.repositories.length} ${connection.repositories.length === 1 ? "repo" : "repos"}`}
			>
				<span className="inline-flex items-center gap-2">
					<ForgeMark
						className="size-(--icon) shrink-0"
						forge={connection.forge}
					/>
					{label}
				</span>
			</CollapsibleTrigger>
			<CollapsibleContent>
				{connection.forge === "gitcafe" &&
				connection.installations.length > 0 ? (
					<div className="pb-3">
						<GitCafeRepositorySelection
							installations={connection.installations}
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
									<ItemTitle className="wrap-anywhere">
										{repo.fullName}
									</ItemTitle>
								</ItemContent>
								{href ? (
									<ItemActions>
										<Button
											aria-label={`Disconnect ${repo.fullName} from ${label}`}
											onClick={() => setSelection({ repo, href })}
											size="sm"
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
					<p className="type-body-sm text-text-2">No repositories connected.</p>
				) : null}
				{waiting ? (
					<div className="flex flex-wrap items-center gap-2 pt-2">
						<output className="min-w-0 type-body-sm text-text-2 wrap-anywhere">
							{checkFailed
								? "Couldn't check access. Try again."
								: stillConnected
									? `Remove ${waiting.fullName} on ${label}, then refresh access here.`
									: `${waiting.fullName} disconnected from ${label}.`}
						</output>
						{stillConnected ? (
							<Button
								disabled={checking}
								onClick={async () => {
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
								size="sm"
								variant="secondary"
							>
								{checking ? "Checking access" : "Refresh access"}
							</Button>
						) : null}
					</div>
				) : null}
			</CollapsibleContent>
			<Dialog
				open={selection !== null}
				onOpenChange={(open) => {
					if (!open) setSelection(null);
				}}
			>
				<DialogContent size="sm">
					<DialogHeader>
						<DialogTitle>Remove repository access on {label}</DialogTitle>
						<DialogDescription>
							Remove {selection?.repo.fullName} from Tripwire's installation on{" "}
							{label}. This page updates after {label} confirms the change.
						</DialogDescription>
					</DialogHeader>
					<DialogBody>
						<p className="type-body-sm text-text-2">
							Keep the app installed for the other repositories. Run history
							stays in Tripwire.
						</p>
					</DialogBody>
					<DialogFooter>
						<Button onClick={() => setSelection(null)} variant="secondary">
							Cancel
						</Button>
						{selection ? (
							<Button
								nativeButton={false}
								render={
									<a
										aria-label={`Continue on ${label} (opens in a new tab)`}
										href={selection.href}
										target="_blank"
										rel="noopener noreferrer"
									>
										Continue on {label}
									</a>
								}
								onClick={() => {
									setWaiting(selection.repo);
									setSelection(null);
								}}
							>
								Continue on {label}
							</Button>
						) : null}
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</Collapsible>
	);
}
