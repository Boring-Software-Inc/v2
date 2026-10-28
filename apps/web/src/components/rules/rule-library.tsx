import {
	libraryGroups,
	type RulePreview,
	ruleUiSchema,
} from "@tripwire/contracts";
import { Button } from "#/components/glaze/ui/button";
import { Card, CardContent } from "#/components/glaze/ui/card";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#/components/glaze/ui/collapsible";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMeta,
	ItemTitle,
} from "#/components/glaze/ui/item";
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
}: {
	rules: readonly RuleConfigView[];
	preview: RulePreview | null;
	mostUsed: readonly string[];
	canEdit: boolean;
	pending: string | null;
	onInstall: (key: string, label: string, ruleIds: string[]) => void;
}) {
	const available = libraryRules(rules);
	const ids = libraryGroups(
		available.map((rule) => rule.ruleId),
		mostUsed,
	);
	const pick = (list: readonly string[]) =>
		list.flatMap((id) => available.filter((rule) => rule.ruleId === id));
	const groups = [
		{ title: "Recommended", rules: pick(ids.recommended) },
		{ title: "Most used", rules: pick(ids.mostUsed) },
	].filter((group) => group.rules.length > 0);

	return (
		<div className="flex flex-col gap-6">
			{groups.map((group) => (
				<section className="flex flex-col gap-3" key={group.title}>
					<h2 className="type-heading-sm">{group.title}</h2>
					<Card>
						<CardContent flush>
							<ul>
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
		<Item className="gap-4 py-3">
			<ItemContent>
				<ItemTitle>
					<h3 className="type-label">{rule.name}</h3>
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
					<ItemDescription className="first-letter:uppercase">
						{rule.blurb}
					</ItemDescription>
				)}
			</ItemContent>
			{expandable ? (
				<CollapsibleTrigger className="max-sm:hidden" size="sm">
					{caughtLabel(count)}
				</CollapsibleTrigger>
			) : (
				<CaughtCount className="max-sm:hidden" count={count} />
			)}
			<ItemActions className="me-0">
				<Button
					aria-label={`Install ${rule.name}`}
					disabled={
						!canEdit ||
						blocked !== null ||
						turnableRuleIds(rules, [rule.ruleId]).length === 0 ||
						(pending !== null && pending !== key)
					}
					onClick={() => onInstall(key, rule.name, [rule.ruleId])}
					pending={pending === key}
					pendingLabel="Installing"
					size="sm"
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
		<Collapsible className="rule-row" render={<li />}>
			{row}
			<CollapsibleContent className="px-3 pb-3">
				<ItemGroup
					aria-label={`Change requests ${rule.name} would have caught`}
				>
					{examples.map((example) => (
						<Item key={example.number} size="sm">
							<ItemContent>
								<ItemTitle>
									<span className="flex min-w-0 gap-3">
										<span className="shrink-0 text-text-2 tabular-nums">
											#{example.number}
										</span>
										<span className="min-w-0 truncate">{example.title}</span>
									</span>
								</ItemTitle>
							</ItemContent>
							<ItemMeta>{example.author}</ItemMeta>
							{example.reason ? (
								<ItemMeta className="max-w-60 truncate">
									{example.reason}
								</ItemMeta>
							) : null}
						</Item>
					))}
				</ItemGroup>
			</CollapsibleContent>
		</Collapsible>
	);
}
