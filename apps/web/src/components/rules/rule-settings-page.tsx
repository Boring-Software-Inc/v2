import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import {
	CONTRIBUTOR_ALLOWLIST_RULE_ID,
	customRuleRef,
	type JsonValue,
	MODERATION_OUTCOME_LABELS,
	type ModerationSubject,
	type RepoModerationPolicyPatch,
	ruleUiSchema,
	SHARED_BLOCKLIST_RULE_ID,
} from "@tripwire/contracts";
import { Button } from "@tripwire/ui/button";
import { Card, CardContent } from "@tripwire/ui/card";
import { Field, FieldLabel, FieldSet } from "@tripwire/ui/field";
import { ActionRow } from "@tripwire/ui/layouts";
import { Skeleton } from "@tripwire/ui/skeleton";
import { notify } from "@tripwire/ui/toast";
import { SupportingText } from "@tripwire/ui/typography";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { Page, PageBody, PageHeader } from "#/components/layouts/page";
import { RepoAllowlist } from "#/components/rules/repo-allowlist";
import { ParamEditor } from "#/components/rules-params/param-editor";
import { ParamValue } from "#/components/rules-params/param-value";
import {
	type SaveQueueCommit,
	SaveQueueProvider,
	UnsavedChangesBar,
	useSaveQueue,
} from "#/components/save-queue";
import { ModerationOutcomePicker } from "#/components/settings/moderation-outcome-picker";
import { useOrgPermission } from "#/hooks/use-org-permission";
import { saveRepoModerationPolicy } from "#/lib/moderation-policy.functions";
import { repoModerationQueryOptions } from "#/lib/moderation-policy.query";
import { orgRepoQueryOptions } from "#/lib/org.query";
import { type RuleConfigView, saveRuleConfig } from "#/lib/rules.functions";
import { ruleConfigsQueryOptions } from "#/lib/rules.query";

const route = getRouteApi("/$org/$repo/rules_/$ruleId/settings");

const SUBJECTS = [
	{ id: "change-request", label: "Pull requests" },
	{ id: "issue", label: "Issues" },
] satisfies { id: ModerationSubject; label: string }[];

export function RuleSettingsPage() {
	const { org, repo, ruleId } = route.useParams();
	const repository = useQuery(orgRepoQueryOptions(org, repo));
	const rules = useQuery(
		ruleConfigsQueryOptions(org, repository.data?.id ?? ""),
	);
	const rule = rules.data?.find((entry) => entry.ruleId === ruleId);
	const github = repository.data?.forge === "github";
	const options = repoModerationQueryOptions(org, repo);
	const settings = useQuery({ ...options, enabled: github && Boolean(rule) });
	const canManage = useOrgPermission(org, "rules:manage");
	const client = useQueryClient();
	const save = useMutation({
		mutationFn: (patch: RepoModerationPolicyPatch) =>
			saveRepoModerationPolicy({ data: { org, repo, patch } }),
		onSuccess: () => client.invalidateQueries({ queryKey: options.queryKey }),
		onError: () =>
			notify.show(
				{ title: "Couldn’t save the rule outcome. Try again." },
				"error",
			),
	});
	const data = settings.data;
	const policyRuleId =
		rule?.source === "custom" ? customRuleRef(ruleId) : ruleId;
	const failed = repository.isError || rules.isError || settings.isError;

	return (
		<DashboardLayout
			counts={{}}
			nestedNavItem={rule ? { parent: "rules", label: rule.name } : undefined}
		>
			<Page purpose="task">
				<PageHeader
					actions={
						<Button href={`/${org}/${repo}/rules`} variant="secondary">
							Back to Rules
						</Button>
					}
					description={rule?.blurb}
					title={rule?.name ?? "Rule settings"}
				/>
				<PageBody>
					{failed ? (
						<ActionRow
							secondary={
								<SupportingText>
									Couldn’t load the rule settings.
								</SupportingText>
							}
							primary={
								<Button
									onAction={() =>
										void (repository.isError
											? repository.refetch()
											: rules.isError
												? rules.refetch()
												: settings.refetch())
									}
									size="small"
									variant="secondary"
								>
									Retry
								</Button>
							}
						/>
					) : !rules.data || (rule && github && !data) ? (
						<output
							data-skeleton-box=""
							aria-label="Loading rule settings"
							className="h-36 w-full"
						>
							<Skeleton fill />
						</output>
					) : !rule ? (
						<SupportingText>
							This rule isn’t available on this repository.
						</SupportingText>
					) : (
						<>
							{github && data && ruleId === CONTRIBUTOR_ALLOWLIST_RULE_ID && (
								<Card>
									<CardContent>
										<RepoAllowlist
											canManage={canManage}
											entries={data.allowlist}
											org={org}
											repo={repo}
										/>
									</CardContent>
								</Card>
							)}
							{repository.data && (
								<RuleParameters
									canManage={canManage}
									key={ruleId}
									org={org}
									repoId={repository.data.id}
									rule={rule}
								/>
							)}
							<Card>
								<CardContent>
									<FieldSet legend="Rule outcomes">
										{rule.management === "managed" ? (
											<SupportingText>
												The workflow controls what happens when this rule fails.
											</SupportingText>
										) : github && data ? (
											<div data-layout-role="rule-outcome-fields">
												{SUBJECTS.map(({ id, label }) => {
													const fallback =
														data.policy.defaults[id] ?? data.orgDefaults[id];
													const isPilotPr =
														ruleId === SHARED_BLOCKLIST_RULE_ID &&
														id === "change-request";
													const repoDefault =
														"Repo default (" +
														MODERATION_OUTCOME_LABELS[fallback] +
														")";
													const saved =
														data.policy.ruleOutcomes[policyRuleId]?.[id];
													return (
														<ModerationOutcomePicker
															defaultLabel={
																isPilotPr
																	? "Pilot default (Human review)"
																	: repoDefault
															}
															disabled={!canManage || save.isPending}
															inheritLabel={isPilotPr ? repoDefault : undefined}
															key={id}
															label={label}
															onChange={(outcome) =>
																save.mutate({
																	ruleOutcome: {
																		ruleId: policyRuleId,
																		subject: id,
																		outcome,
																	},
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
											</div>
										) : (
											<SupportingText>
												Rule outcomes are available for GitHub repositories.
											</SupportingText>
										)}
									</FieldSet>
								</CardContent>
							</Card>
						</>
					)}
				</PageBody>
			</Page>
		</DashboardLayout>
	);
}

function RuleParameters({
	canManage,
	org,
	repoId,
	rule,
}: {
	canManage: boolean;
	org: string;
	repoId: string;
	rule: RuleConfigView;
}) {
	const params = ruleUiSchema(rule.ruleId)?.params ?? [];
	const client = useQueryClient();
	if (params.length === 0) return null;

	const config =
		rule.config !== null &&
		Object(rule.config) === rule.config &&
		!Array.isArray(rule.config)
			? (rule.config as { [key: string]: JsonValue })
			: {};
	const canEdit =
		canManage &&
		rule.enabled &&
		!rule.forgeBlockReason &&
		rule.management === "standalone";
	const commit: SaveQueueCommit = async (pending) => {
		const next = { ...config };
		for (const param of params) {
			const value = pending[param.key];
			if (value !== undefined) next[param.key] = value;
		}
		const result = await saveRuleConfig({
			data: {
				org,
				repoId,
				ruleId: rule.ruleId,
				enabled: rule.enabled,
				config: next,
			},
		});
		if ("error" in result) {
			notify.show({ title: result.error }, "error");
			return { error: result.error };
		}
		await client.invalidateQueries({
			queryKey: ruleConfigsQueryOptions(org, repoId).queryKey,
		});
		notify.show({ title: "Rule settings saved" }, "success");
		return { ok: true };
	};

	return (
		<SaveQueueProvider
			commit={commit}
			isEqual={(left, right) => JSON.stringify(left) === JSON.stringify(right)}
			savedValues={config}
		>
			<Card>
				<CardContent>
					<ParameterFields canEdit={canEdit} config={config} params={params} />
				</CardContent>
			</Card>
			<UnsavedChangesBar />
		</SaveQueueProvider>
	);
}

function ParameterFields({
	canEdit,
	config,
	params,
}: {
	canEdit: boolean;
	config: { [key: string]: JsonValue };
	params: NonNullable<ReturnType<typeof ruleUiSchema>>["params"];
}) {
	const { setField, valueFor, isCommitting } = useSaveQueue();
	return (
		<FieldSet legend="Rule parameters">
			{params.map((param) => {
				const value = valueFor(param.key) ?? config[param.key];
				return (
					<Field key={param.key}>
						<FieldLabel>{param.label}</FieldLabel>
						{canEdit && !isCommitting ? (
							<ParamEditor
								autoFocus={false}
								key={
									param.kind === "string-list"
										? param.key
										: JSON.stringify(value)
								}
								onCancel={() => undefined}
								onSave={(next) => setField(param.key, next)}
								param={param}
								value={value}
							/>
						) : (
							<ParamValue param={param} value={value} />
						)}
					</Field>
				);
			})}
		</FieldSet>
	);
}
