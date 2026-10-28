import {
	FORGE_BY_ID,
	type Forge,
	type OrganizationForgeConnection,
} from "@tripwire/contracts";
import { useState } from "react";
import { ForgeMark } from "#/components/common/forge-marks";
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
type ConnectionInstallation =
	OrganizationForgeConnection["installations"][number];

function installationSettingsUrl(
	forge: Forge,
	installation: ConnectionInstallation | undefined,
): string | null {
	if (!installation) return null;
	const id = encodeURIComponent(installation.installationId);
	if (forge === "gitcafe" && installation.owner)
		return `https://git.cafe/orgs/${encodeURIComponent(installation.owner)}/settings/apps/${id}`;
	if (forge === "github" && /^\d+$/.test(installation.installationId)) {
		if (installation.accountType === "User")
			return `https://github.com/settings/installations/${id}`;
		if (installation.accountType === "Organization" && installation.owner)
			return `https://github.com/organizations/${encodeURIComponent(installation.owner)}/settings/installations/${id}`;
	}
	return null;
}

export function OrganizationConnectionRow({
	connection,
	onCheckAccess,
}: {
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
			disabled={connection.repositories.length === 0}
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
				<ItemGroup aria-label={`${label} repositories`} variant="plain">
					{connection.repositories.map((repo) => {
						const installation = connection.installations.find(
							(item) => item.installationId === repo.installationId,
						);
						const href = installationSettingsUrl(
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
