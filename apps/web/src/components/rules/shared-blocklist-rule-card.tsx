import { SHARED_BLOCKLIST_RULE_ID } from "@tripwire/contracts";
import { AgentOutline } from "#/components/agent/agent-outline";
import {
	RULE_CARD_CLASS,
	RULE_FOOTER_CLASS,
	RULE_HEADER_CLASS,
	RULE_PANEL_CLASS,
	RULE_SENTENCE_CLASS,
} from "#/components/rules/rule-card-frame";
import { RuleSettingsMenu } from "#/components/rules/rule-settings-menu";
import { Button } from "#/design-system/ui/button";
import { Card, CardFooter } from "#/design-system/ui/card";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemTitle,
} from "#/design-system/ui/item";
import { Panel } from "#/design-system/ui/panel";
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
						aria-label="Install Pilot"
						disabled={!canEdit}
						onClick={onInstall}
						pending={pending}
						pendingLabel="Installing"
						size="sm"
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
			<Card className={RULE_CARD_CLASS}>
				<Panel className={RULE_PANEL_CLASS}>
					<div className={RULE_HEADER_CLASS}>
						<h2 className="min-w-0 truncate type-label-lg">Pilot</h2>
						<span className="flex items-center">
							{" "}
							<Button
								aria-label="Uninstall Pilot"
								disabled={!canEdit}
								data-layout-role="pilot-rule-action"
								onClick={onUninstall}
								pending={pending || undefined}
								pendingLabel="Uninstalling"
								size="sm"
								variant="secondary"
							>
								Uninstall
							</Button>
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
				<CardFooter className={RULE_FOOTER_CLASS}>
					<a href={siteConfig.pilotUrl}>Browse the public list</a>
				</CardFooter>
			</Card>
		</div>
	);
}
