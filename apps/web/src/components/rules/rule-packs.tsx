import {
	previewCaught,
	RULE_CATALOG,
	RULE_PACKS,
	type RulePreview,
	sameSettings,
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

export function rulesCaught(
	preview: RulePreview | null,
	rules: readonly RuleConfigView[],
	ruleIds: readonly string[],
): number | null {
	const tuned = ruleIds.some((id) => {
		const rule = rules.find((r) => r.ruleId === id);
		return rule !== undefined && !sameSettings(rule.config, rule.defaultConfig);
	});
	return tuned ? null : previewCaught(preview, ruleIds);
}

export function replayRuleIds(rules: readonly RuleConfigView[]): string[] {
	const on = rules
		.filter((rule) => rule.enabled && rule.source === "built-in")
		.map((rule) => rule.ruleId);
	const chosen =
		on.length > 0
			? on
			: RULE_PACKS.filter((pack) => pack.recommended).flatMap((pack) => [
					...pack.ruleIds,
				]);
	return chosen.filter((id) => {
		const rule = rules.find((r) => r.ruleId === id);
		return rule === undefined || sameSettings(rule.config, rule.defaultConfig);
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
	onInstall,
	heading = true,
}: {
	heading?: boolean;
	rules: readonly RuleConfigView[];
	preview: RulePreview | null;
	repoName: string;
	canEdit: boolean;
	pending: string | null;
	onInstall: (key: string, label: string, ruleIds: string[]) => void;
}) {
	return (
		<section
			aria-label={heading ? undefined : "Rule packs"}
			aria-labelledby={heading ? "rule-packs-title" : undefined}
			className="flex flex-col gap-3"
		>
			<div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
				{heading ? (
					<h2 className="type-heading-sm" id="rule-packs-title">
						Start with a pack
					</h2>
				) : null}
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
										count={rulesCaught(preview, rules, pack.ruleIds)}
									/>
									<ItemActions className="me-0">
										<Button
											aria-label={`Install ${pack.name}`}
											disabled={
												!canEdit ||
												turnable.length === 0 ||
												(pending !== null && pending !== key)
											}
											onClick={() => onInstall(key, pack.name, turnable)}
											pending={pending === key}
											pendingLabel="Installing"
											size="sm"
											variant={pack.recommended ? "primary" : "secondary"}
										>
											Install pack
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
