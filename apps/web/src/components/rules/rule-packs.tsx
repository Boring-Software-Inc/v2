import {
	previewCaught,
	RULE_CATALOG,
	RULE_PACKS,
	type RulePreview,
} from "@tripwire/contracts";
import { Badge } from "#/components/glaze/ui/badge";
import { Button } from "#/components/glaze/ui/button";
import { Card, CardContent } from "#/components/glaze/ui/card";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemTitle,
} from "#/components/glaze/ui/item";
import { CaughtCount } from "#/components/rules/caught-count";
import type { RuleConfigView } from "#/lib/rules.functions";

export function turnableRuleIds(
	rules: readonly RuleConfigView[],
	ruleIds: readonly string[],
): string[] {
	return ruleIds.filter((id) => {
		const rule = rules.find((r) => r.ruleId === id);
		return (
			rule !== undefined &&
			!rule.enabled &&
			rule.management === "standalone" &&
			rule.forgeBlockReason === null &&
			rule.unavailableReason === null
		);
	});
}

export function PreviewWindow({
	preview,
	repoName,
}: {
	preview: RulePreview | null;
	repoName: string;
}) {
	if (preview === null) {
		return null;
	}
	return (
		<p className="type-caption text-text-2">
			Counts use {repoName}'s last {preview.windowDays} days,{" "}
			{preview.changeRequests}{" "}
			{preview.changeRequests === 1 ? "change request" : "change requests"}
		</p>
	);
}

export function RulePacks({
	rules,
	preview,
	repoName,
	canEdit,
	pending,
	onTurnOn,
}: {
	rules: readonly RuleConfigView[];
	preview: RulePreview | null;
	repoName: string;
	canEdit: boolean;
	pending: string | null;
	onTurnOn: (key: string, label: string, ruleIds: string[]) => void;
}) {
	return (
		<section aria-labelledby="rule-packs-title" className="flex flex-col gap-3">
			<div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
				<h2 className="type-heading-sm" id="rule-packs-title">
					Start with a pack
				</h2>
				<PreviewWindow preview={preview} repoName={repoName} />
			</div>
			<Card>
				<CardContent flush>
					<ItemGroup variant="plain">
						{RULE_PACKS.map((pack) => {
							const turnable = turnableRuleIds(rules, pack.ruleIds);
							const names = pack.ruleIds.map(
								(id) =>
									RULE_CATALOG.find((entry) => entry.ruleId === id)?.name ?? id,
							);
							const key = `pack:${pack.id}`;
							return (
								<Item className="gap-4 py-3" key={pack.id}>
									<ItemContent>
										<ItemTitle>
											<span>{pack.name}</span>
											{pack.recommended ? (
												<Badge className="shrink-0">Recommended</Badge>
											) : null}
										</ItemTitle>
										<ItemDescription>{names.join(", ")}</ItemDescription>
									</ItemContent>
									<CaughtCount
										className="max-sm:hidden"
										count={previewCaught(preview, pack.ruleIds)}
									/>
									<ItemActions className="me-0">
										<Button
											aria-label={`Turn on ${pack.name}`}
											disabled={
												!canEdit ||
												turnable.length === 0 ||
												(pending !== null && pending !== key)
											}
											onClick={() => onTurnOn(key, pack.name, turnable)}
											pending={pending === key}
											pendingLabel="Turning on"
											size="sm"
											variant={pack.recommended ? "primary" : "secondary"}
										>
											Turn on
										</Button>
									</ItemActions>
								</Item>
							);
						})}
					</ItemGroup>
				</CardContent>
			</Card>
		</section>
	);
}
