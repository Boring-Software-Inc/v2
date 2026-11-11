import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	customRuleRef,
	MODERATION_OUTCOME_LABELS,
	type ModerationSubject,
	type RepoModerationPolicyPatch,
	SHARED_BLOCKLIST_RULE_ID,
} from "@tripwire/contracts";
import { ActionRow } from "@tripwire/ui/layouts";
import { useId, useState } from "react";
import { RepoAllowlist } from "#/components/rules/repo-allowlist";
import {
	ModerationOutcomeHelp,
	ModerationOutcomePicker,
} from "#/components/settings/moderation-outcome-picker";
import { Button } from "#/design-system/ui/button";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "#/design-system/ui/dialog";
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldGroup,
	FieldLabel,
	FieldLegend,
	FieldSet,
} from "#/design-system/ui/field";
import { Select } from "#/design-system/ui/select";
import { Skeleton } from "#/design-system/ui/skeleton";
import { Switch } from "#/design-system/ui/switch";
import { toast } from "#/design-system/ui/toast";
import { Body, SupportingText } from "#/design-system/ui/typography";
import { saveRepoModerationPolicy } from "#/lib/moderation-policy.functions";
import { repoModerationQueryOptions } from "#/lib/moderation-policy.query";
import type { RuleConfigView } from "#/lib/rules.functions";

const SUBJECTS = [
	{ id: "change-request", label: "Pull requests" },
	{ id: "issue", label: "Issues" },
] satisfies { id: ModerationSubject; label: string }[];

export function RepoModerationSettings({
	org,
	repo,
	canManage,
	rules,
	pilotEnabled,
	onBrowseLibrary,
}: {
	org: string;
	repo: string;
	canManage: boolean;
	rules: RuleConfigView[] | undefined;
	pilotEnabled: boolean;
	onBrowseLibrary: () => void;
}) {
	const issueRulesId = useId();
	const [open, setOpen] = useState(false);
	const [selectedRule, setSelectedRule] = useState<string | null>(null);
	const options = repoModerationQueryOptions(org, repo);
	const query = useQuery({ ...options, enabled: open });
	const client = useQueryClient();
	const save = useMutation({
		mutationFn: (patch: RepoModerationPolicyPatch) =>
			saveRepoModerationPolicy({ data: { org, repo, patch } }),
		onSuccess: () => client.invalidateQueries({ queryKey: options.queryKey }),
		onError: () => toast.fail("Couldn’t save the rule outcomes. Try again."),
	});

	const installed = (rules ?? [])
		.filter((rule) => rule.enabled && rule.management === "standalone")
		.map((rule) => ({
			value:
				rule.source === "custom" ? customRuleRef(rule.ruleId) : rule.ruleId,
			label: rule.name,
		}));
	if (
		pilotEnabled &&
		!installed.some(({ value }) => value === SHARED_BLOCKLIST_RULE_ID)
	) {
		installed.push({ value: SHARED_BLOCKLIST_RULE_ID, label: "Pilot" });
	}
	installed.sort((a, b) => a.label.localeCompare(b.label));
	const ruleId = installed.some(({ value }) => value === selectedRule)
		? selectedRule
		: installed[0]?.value;
	const data = query.data;
	const disabled = !canManage || save.isPending;

	return (
		<Dialog onOpenChange={setOpen} open={open}>
			<DialogTrigger render={<Button variant="secondary" />}>
				Rule outcomes
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Rule outcomes</DialogTitle>
					<DialogDescription>
						Choose what happens when standalone rules fail. Workflows set their
						own actions.
					</DialogDescription>
				</DialogHeader>
				<DialogBody>
					{data ? (
						<>
							<FieldSet>
								<FieldLegend variant="label">Repository defaults</FieldLegend>
								<FieldGroup className="sm:grid sm:grid-cols-2">
									{SUBJECTS.map(({ id, label }) => (
										<ModerationOutcomePicker
											defaultLabel={`Org default (${MODERATION_OUTCOME_LABELS[data.orgDefaults[id]]})`}
											disabled={disabled}
											key={id}
											label={label}
											onChange={(outcome) => {
												if (outcome !== "inherit")
													save.mutate({ defaults: { [id]: outcome } });
											}}
											value={data.policy.defaults[id] ?? null}
										/>
									))}
								</FieldGroup>
								<ModerationOutcomeHelp />
								<Field orientation="horizontal">
									<FieldContent>
										<FieldLabel id={issueRulesId}>
											Apply standalone rules to issues
										</FieldLabel>
										<FieldDescription id={`${issueRulesId}-description`}>
											Tripwire checks new issues against rules that support
											issues.
										</FieldDescription>
									</FieldContent>
									<Switch
										aria-describedby={`${issueRulesId}-description`}
										aria-labelledby={issueRulesId}
										checked={data.policy.issueRulesEnabled}
										disabled={!canManage}
										onCheckedChange={(issueRulesEnabled) =>
											save.mutate({ issueRulesEnabled })
										}
										pending={save.isPending}
									/>
								</Field>
							</FieldSet>
							<FieldSet>
								<FieldLegend variant="label">Per-rule overrides</FieldLegend>
								{ruleId ? (
									<>
										<Select
											aria-label="Standalone rule"
											items={installed}
											native
											onValueChange={setSelectedRule}
											value={ruleId}
										/>
										<FieldGroup className="sm:grid sm:grid-cols-2">
											{SUBJECTS.map(({ id, label }) => {
												const fallback =
													data.policy.defaults[id] ?? data.orgDefaults[id];
												const isPilotPr =
													ruleId === SHARED_BLOCKLIST_RULE_ID &&
													id === "change-request";
												const repoDefault = `Repo default (${MODERATION_OUTCOME_LABELS[fallback]})`;
												const saved = data.policy.ruleOutcomes[ruleId]?.[id];
												return (
													<ModerationOutcomePicker
														defaultLabel={
															isPilotPr
																? "Pilot default (Human review)"
																: repoDefault
														}
														disabled={disabled}
														inheritLabel={isPilotPr ? repoDefault : undefined}
														key={id}
														label={label}
														onChange={(outcome) =>
															save.mutate({
																ruleOutcome: { ruleId, subject: id, outcome },
															})
														}
														value={
															saved === "inherit" && !isPilotPr
																? null
																: (saved ?? null)
														}
													/>
												);
											})}
										</FieldGroup>
									</>
								) : (
									<SupportingText>
										Installed standalone rules appear here.
									</SupportingText>
								)}
							</FieldSet>
							<RepoAllowlist
								canManage={canManage}
								entries={data.allowlist}
								onBrowseLibrary={() => {
									setOpen(false);
									onBrowseLibrary();
								}}
								org={org}
								repo={repo}
							/>
						</>
					) : query.isError ? (
						<ActionRow
							secondary={<Body>Couldn’t load the rule outcomes.</Body>}
							primary={
								<Button
									onClick={() => void query.refetch()}
									size="sm"
									variant="secondary"
								>
									Retry
								</Button>
							}
						/>
					) : (
						<Skeleton
							aria-label="Loading rule outcomes"
							className="h-36 w-full"
						/>
					)}
				</DialogBody>
			</DialogContent>
		</Dialog>
	);
}
