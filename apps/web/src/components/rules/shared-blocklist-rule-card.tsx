import { SHARED_BLOCKLIST_RULE_ID } from "@tripwire/contracts";
import { Button } from "@tripwire/ui/button";
import { Card, CardFooter } from "@tripwire/ui/card";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemTitle,
} from "@tripwire/ui/item";
import { Panel } from "@tripwire/ui/panel";
import { useState } from "react";
import { AgentOutline } from "#/components/agent/agent-outline";
import { ConfirmDestructiveDialog } from "#/components/common/confirm-destructive-dialog";
import {
	RULE_HEADER_CLASS,
	RULE_SENTENCE_CLASS,
} from "#/components/rules/rule-card-frame";
import { RuleSettingsMenu } from "#/components/rules/rule-settings-menu";
import { useAgentMotion } from "#/hooks/use-agent-motion";
import { siteConfig } from "#/lib/site-config";

export const PILOT_DESCRIPTION =
	"Check contribution authors against the public Pilot list.";

export function PilotLibraryRow({
	canEdit,
	pending,
	onInstall,
}: {
	canEdit: boolean;
	pending: boolean;
	onInstall: () => void;
}) {
	return (
		<li className="rule-row">
			<Item data-layout-role="pilot-library-row">
				<ItemContent>
					<ItemTitle>
						<h3>Pilot</h3>
					</ItemTitle>
					<ItemDescription>{PILOT_DESCRIPTION}</ItemDescription>
				</ItemContent>
				<ItemActions>
					<Button
						ariaLabel="Install Pilot"
						disabled={!canEdit}
						onAction={onInstall}
						pending={pending}
						pendingLabel="Installing"
						reservePendingWidth
						size="small"
						variant="secondary"
					>
						Install
					</Button>
				</ItemActions>
			</Item>
		</li>
	);
}

export function SharedBlocklistRuleCard({
	canEdit,
	scope,
	highlighted,
	pending,
	onUninstall,
}: {
	canEdit: boolean;
	scope?: { org: string; repo: string };
	highlighted: boolean;
	pending: boolean;
	onUninstall: () => void;
}) {
	const motion = useAgentMotion();
	const [confirmingUninstall, setConfirmingUninstall] = useState(false);

	return (
		<div className="relative" id="shared-spam-blocklist">
			{highlighted ? (
				<AgentOutline
					active
					motion={motion}
					radius={14}
					seed="pilot-rule"
					tone="white"
				/>
			) : null}
			<Card data-layout-role="rule-card-frame">
				<Panel data-layout-role="rule-card-panel">
					<div className={RULE_HEADER_CLASS}>
						<h2 className="min-w-0 truncate type-label-lg">Pilot</h2>
						<span className="flex items-center">
							{" "}
							<span data-layout-role="pilot-rule-action">
								<Button
									ariaLabel="Uninstall Pilot"
									disabled={!canEdit || pending}
									onAction={() => setConfirmingUninstall(true)}
									size="small"
									variant="secondary"
								>
									Uninstall
								</Button>
							</span>
							{scope && (
								<RuleSettingsMenu
									{...scope}
									name="Pilot"
									ruleId={SHARED_BLOCKLIST_RULE_ID}
								/>
							)}
						</span>
					</div>
					<p className={RULE_SENTENCE_CLASS}>{PILOT_DESCRIPTION}</p>
				</Panel>
				<CardFooter data-layout-role="rule-card-footer">
					<a href={siteConfig.pilotUrl}>Browse the public list</a>
				</CardFooter>
			</Card>
			<ConfirmDestructiveDialog
				confirmLabel="Uninstall Pilot"
				description="Pilot will stop checking new contribution authors after you save this change."
				onConfirm={() => {
					onUninstall();
					return undefined;
				}}
				onOpenChange={setConfirmingUninstall}
				open={confirmingUninstall}
				pendingLabel="Uninstalling"
				title="Uninstall Pilot?"
			/>
		</div>
	);
}
