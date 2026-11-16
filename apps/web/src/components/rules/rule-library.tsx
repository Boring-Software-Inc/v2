import {
	libraryGroups,
	type RulePreview,
	ruleUiSchema,
} from "@tripwire/contracts";
import { Button } from "@tripwire/ui/button";
import { Card, CardContent } from "@tripwire/ui/card";
import { Collapsible } from "@tripwire/ui/collapsible";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMeta,
	ItemTitle,
} from "@tripwire/ui/item";
import type { ReactNode } from "react";
import { CaughtCount, caughtLabel } from "#/components/rules/caught-count";
import { rulesCaught, turnableRuleIds } from "#/components/rules/rule-packs";
import { ParamSentence } from "#/components/rules-params/param-sentence";
import type { RuleConfigView } from "#/lib/rules.functions";

export function libraryRules(
	rules: readonly RuleConfigView[],
): RuleConfigView[] {
	return rules.filter(
		(rule) =>
			rule.source === "built-in" &&
			!rule.enabled &&
			rule.management === "standalone",
	);
}

export function RuleLibrary({
	rules,
	preview,
	mostUsed,
	canEdit,
	pending,
	onInstall,
	pilot,
}: {
	rules: readonly RuleConfigView[];
	preview: RulePreview | null;
	mostUsed: readonly string[];
	canEdit: boolean;
	pending: string | null;
	onInstall: (key: string, label: string, ruleIds: string[]) => void;
	pilot?: ReactNode;
}) {
	const available = libraryRules(rules);
	const ids = libraryGroups(
		available.map((rule) => rule.ruleId),
		mostUsed,
	);
	const pick = (list: readonly string[]) =>
		list.flatMap((id) => available.filter((rule) => rule.ruleId === id));
	const groups = [
		{ title: "Recommended", rules: pick(ids.recommended), extra: null },
		{ title: "Shared blocklists", rules: [], extra: pilot },
		{ title: "Most used", rules: pick(ids.mostUsed), extra: null },
	].filter((group) => group.rules.length > 0 || group.extra);

	return (
		<div className="flex flex-col gap-6">
			{groups.map((group) => (
				<section
					className="flex flex-col composition-gap-section"
					key={group.title}
				>
					<h2 className="type-heading-sm">{group.title}</h2>
					<Card data-layout-role="rule-library-frame">
						<CardContent flush>
							<ul>
								{group.extra}
								{group.rules.map((rule) => (
									<LibraryRow
										canEdit={canEdit}
										key={rule.ruleId}
										onInstall={onInstall}
										pending={pending}
										preview={preview}
										rule={rule}
										rules={rules}
									/>
								))}
							</ul>
						</CardContent>
					</Card>
				</section>
			))}
		</div>
	);
}

function LibraryRow({
	rule,
	rules,
	preview,
	canEdit,
	pending,
	onInstall,
}: {
	rule: RuleConfigView;
	rules: readonly RuleConfigView[];
	preview: RulePreview | null;
	canEdit: boolean;
	pending: string | null;
	onInstall: (key: string, label: string, ruleIds: string[]) => void;
}) {
	const count = rulesCaught(preview, rules, [rule.ruleId]);
	const examples =
		preview?.rules.find((entry) => entry.ruleId === rule.ruleId)?.examples ??
		[];
	const blocked = rule.forgeBlockReason ?? rule.unavailableReason;
	const key = `rule:${rule.ruleId}`;
	const hasParams = (ruleUiSchema(rule.ruleId)?.params.length ?? 0) > 0;
	const expandable = count !== null && count > 0 && examples.length > 0;

	const row = (
		<Item
			data-layout-role="rule-library-row"
			data-parameters={!blocked && hasParams ? "" : undefined}
		>
			<ItemContent>
				<ItemTitle>
					<h3 className="truncate content-label" title={rule.name}>
						{rule.name}
					</h3>
				</ItemTitle>
				{blocked ? (
					<ItemDescription>{blocked}</ItemDescription>
				) : hasParams ? (
					<ParamSentence
						canEdit={false}
						className="first-letter:uppercase"
						config={rule.config}
						onSaveParam={() => undefined}
						ruleId={rule.ruleId}
					/>
				) : (
					<ItemDescription data-layout-role="rule-library-description">
						{rule.blurb}
					</ItemDescription>
				)}
			</ItemContent>
			{expandable ? null : (
				<CaughtCount className="max-sm:hidden" count={count} />
			)}
			<ItemActions data-layout-role="rule-library-action">
				<Button
					ariaLabel={`Install ${rule.name}`}
					disabled={
						!canEdit ||
						blocked !== null ||
						turnableRuleIds(rules, [rule.ruleId]).length === 0 ||
						(pending !== null && pending !== key)
					}
					onAction={() => onInstall(key, rule.name, [rule.ruleId])}
					pending={pending === key}
					pendingLabel="Installing"
					reservePendingWidth
					size="small"
					variant="secondary"
				>
					Install
				</Button>
			</ItemActions>
		</Item>
	);

	if (!expandable) {
		return <li className="rule-row">{row}</li>;
	}
	return (
		<Collapsible
			as="li"
			header={{
				content: row,
				trigger: caughtLabel(count),
				triggerPosition: "after-content",
			}}
			triggerTone="quiet"
		>
			<div className="composition-inline-inset composition-bottom-section">
				<ItemGroup
					aria-label={`Change requests ${rule.name} would have caught`}
				>
					{examples.map((example) => (
						<Item key={example.number} density="compact">
							<ItemContent>
								<ItemTitle>
									<span className="flex min-w-0 composition-gap-section">
										<span className="shrink-0 tone-content-secondary tabular-nums">
											#{example.number}
										</span>
										<span className="min-w-0 truncate">{example.title}</span>
									</span>
								</ItemTitle>
							</ItemContent>
							<ItemMeta>{example.author}</ItemMeta>
							{example.reason ? (
								<ItemMeta data-layout-role="rule-example-reason">
									{example.reason}
								</ItemMeta>
							) : null}
						</Item>
					))}
				</ItemGroup>
			</div>
		</Collapsible>
	);
}
