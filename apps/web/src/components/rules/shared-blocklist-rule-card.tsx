import { Link } from "@tanstack/react-router";
import { AgentOutline } from "#/components/agent/agent-outline";
import {
	RULE_CARD_CLASS,
	RULE_FOOTER_CLASS,
	RULE_HEADER_CLASS,
	RULE_PANEL_CLASS,
	RULE_SENTENCE_CLASS,
} from "#/components/rules/rule-card-frame";
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

export const PILOT_DESCRIPTION =
	"Send pull requests from listed accounts to Human review.";

export function PilotLibraryRow({
	pending,
	onInstall,
}: {
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
	highlighted,
	pending,
	onUninstall,
}: {
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
						<Button
							aria-label="Uninstall Pilot"
							data-layout-role="pilot-rule-action"
							onClick={onUninstall}
							pending={pending || undefined}
							pendingLabel="Uninstalling"
							size="sm"
							variant="secondary"
						>
							Uninstall
						</Button>
					</div>
					<p className={RULE_SENTENCE_CLASS}>{PILOT_DESCRIPTION}</p>
				</Panel>
				<CardFooter className={RULE_FOOTER_CLASS}>
					<Link to="/pilot">Browse the public list</Link>
				</CardFooter>
			</Card>
		</div>
	);
}
