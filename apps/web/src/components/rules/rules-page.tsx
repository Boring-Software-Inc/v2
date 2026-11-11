import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import {
	type JsonValue,
	ruleUiSchema,
	SHARED_BLOCKLIST_RULE_ID,
} from "@tripwire/contracts";
import { useMemo, useState } from "react";
import { ArmCallout } from "#/components/arming/arm-callout";
import { Collection } from "#/components/collection/collection";
import { ShaderDither } from "#/components/dither/shader-dither";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { Page, PageBody, PageHeader } from "#/components/layouts/page";
import { MascotArt } from "#/components/mascot/mascot-art";
import {
	CustomRuleBuilder,
	type CustomRuleDraft,
} from "#/components/rules/custom-rule-builder";
import { RepoModerationSettings } from "#/components/rules/repo-moderation-settings";
import { RuleCard } from "#/components/rules/rule-card";
import { RuleHeaderStats } from "#/components/rules/rule-header-stats";
import { libraryRules, RuleLibrary } from "#/components/rules/rule-library";
import { RulePacks } from "#/components/rules/rule-packs";
import {
	RULES_COLLECTION,
	RULES_TABS,
	type RulesTab,
} from "#/components/rules/rules-collection";
import { RuleGridSkeleton } from "#/components/rules/rules-page-skeleton";
import {
	PILOT_DESCRIPTION,
	PilotLibraryRow,
	SharedBlocklistRuleCard,
} from "#/components/rules/shared-blocklist-rule-card";
import { useInstallRules } from "#/components/rules/use-install-rules";
import {
	type SaveQueueCommit,
	SaveQueueProvider,
	type SaveQueueValue,
	type SaveQueueValues,
	UnsavedChangesBar,
} from "#/components/save-queue";
import { Add, Icon } from "#/design-system/icon";
import { Button } from "#/design-system/ui/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyRetry,
	EmptyTitle,
} from "#/design-system/ui/empty-state";
import {
	SegmentedControl,
	SegmentedControlItem,
} from "#/design-system/ui/segmented-control";
import { toast } from "#/design-system/ui/toast";
import { useCollection } from "#/hooks/use-collection";
import { useOrgPermission } from "#/hooks/use-org-permission";
import { useSharedBlocklistPilot } from "#/hooks/use-shared-blocklist-pilot";
import { useTimedHighlight } from "#/hooks/use-timed-highlight";
import {
	deleteCustomRule,
	saveCustomRule,
	setCustomRuleEnabled,
} from "#/lib/custom-rules.functions";
import { orgContextQueryOptions, orgRepoQueryOptions } from "#/lib/org.query";
import {
	type RuleConfigView,
	saveRuleConfig,
	upgradeRuleConfig,
} from "#/lib/rules.functions";
import {
	ruleConfigsQueryOptions,
	ruleLibraryQueryOptions,
	rulesQueryKeys,
	rulesStatsQueryOptions,
} from "#/lib/rules.query";
import { trackEvent } from "#/lib/track";

const routeApi = getRouteApi("/$org/$repo/rules");

/** Deep equality for the queue's noop-clearing — rule param values include
 * arrays (honeypot paths), where ordering IS a real change. */
function jsonEqual(a: SaveQueueValue, b: SaveQueueValue): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

function asObject(config: JsonValue): Record<string, JsonValue> {
	if (config === null || Array.isArray(config) || Object(config) !== config) {
		return {};
	}
	return config as Record<string, JsonValue>;
}

/**
 * The queue's saved baseline: per STANDALONE rule, `${ruleId}:enabled`, one
 * `${ruleId}:param:${key}` per param (falling back to the param default the
 * sentence displays), and `${ruleId}:upgrade` (false) when an update is held.
 * Managed rules contribute no keys — their cards are read-only.
 */
function ruleSavedValues(rules: RuleConfigView[] | undefined): SaveQueueValues {
	const values: SaveQueueValues = {};
	for (const rule of rules ?? []) {
		if (rule.management !== "standalone") {
			continue;
		}
		values[`${rule.ruleId}:enabled`] = rule.enabled;
		const config = asObject(rule.config);
		for (const param of ruleUiSchema(rule.ruleId)?.params ?? []) {
			const fallback =
				"default" in param
					? param.kind === "string-list"
						? [...param.default]
						: param.default
					: undefined;
			values[`${rule.ruleId}:param:${param.key}`] =
				config[param.key] ?? fallback;
		}
		if (rule.held) {
			values[`${rule.ruleId}:upgrade`] = false;
		}
	}
	return values;
}

export function RulesPage() {
	// Scoped to the URL's repo (§8) — the layout route already resolved it.
	const { org, repo: repoName } = routeApi.useParams();
	const { data: repo } = useQuery(orgRepoQueryOptions(org, repoName));
	const { data: orgContext } = useQuery(orgContextQueryOptions(org));
	const isAdmin = useOrgPermission(org, "rules:manage");
	const [builderOpen, setBuilderOpen] = useState(false);
	const repoId = repo?.id ?? "";
	const rulesQuery = useQuery(ruleConfigsQueryOptions(org, repoId));
	const pilotManaged = rulesQuery.data?.some(
		(rule) =>
			rule.ruleId === SHARED_BLOCKLIST_RULE_ID && rule.management === "managed",
	);
	const rules = useMemo(
		() =>
			rulesQuery.data?.filter(
				(rule) =>
					rule.ruleId !== SHARED_BLOCKLIST_RULE_ID ||
					rule.management === "managed",
			),
		[rulesQuery.data],
	);
	const statsQuery = useQuery(rulesStatsQueryOptions(org, repoId));
	const queryClient = useQueryClient();

	const libraryQuery = useQuery(ruleLibraryQueryOptions(org, repoId));
	const { tab } = routeApi.useSearch();
	const navigate = routeApi.useNavigate();
	const { install, pending } = useInstallRules(org, repoId);
	const {
		pilot,
		save: savePilot,
		saving: savingPilot,
		installedAt,
	} = useSharedBlocklistPilot();
	const pilotHighlighted = useTimedHighlight(installedAt, 5_000);

	const installedRules = (rules ?? []).filter((r) => r.enabled);
	const customRules = (rules ?? []).filter((r) => r.source === "custom");
	const offered = libraryRules(rules ?? []);
	const pilotOffered = !pilotManaged && pilot?.enabled === false;
	const libraryCount = offered.length + Number(pilotOffered);
	const installed =
		!pilotManaged && pilot?.enabled
			? [
					...installedRules,
					{
						kind: "pilot" as const,
						ruleId: SHARED_BLOCKLIST_RULE_ID,
						name: "Pilot",
						blurb: PILOT_DESCRIPTION,
						sentence: null,
						matches24h: 0,
					},
				]
			: installedRules;
	const starting =
		rules !== undefined &&
		tab === undefined &&
		installed.length === 0 &&
		customRules.length === 0;
	const activeTab: RulesTab =
		tab ??
		(installed.length > 0
			? "installed"
			: customRules.length > 0
				? "custom"
				: "library");
	const showTab = (next: RulesTab) =>
		navigate({ to: ".", search: (prev) => ({ ...prev, tab: next }) });
	const setPilotInstalled = (enabled: boolean) =>
		savePilot.mutate(enabled, {
			onError: () => toast.fail("Couldn’t save Pilot. Try again."),
			onSuccess: () => {
				if (enabled) {
					void navigate({
						to: ".",
						search: { tab: "installed" },
						hash: SHARED_BLOCKLIST_RULE_ID,
					});
				}
			},
		});

	const collection = useCollection(
		RULES_COLLECTION,
		rules === undefined
			? undefined
			: activeTab === "custom"
				? customRules
				: installed,
	);

	/**
	 * One batch, N per-rule writes: group pending keys by rule, run a queued
	 * upgrade first (it re-pins the version), then the rule's config write. A
	 * rule that fails keeps ALL its keys queued via `failedKeys` (the unit's
	 * partial-failure contract); successes clear, and invalidation only runs
	 * when something persisted.
	 */
	const commitBatch: SaveQueueCommit = async (pending) => {
		const byRule = new Map<string, string[]>();
		for (const key of Object.keys(pending)) {
			const ruleId = key.split(":")[0] ?? key;
			byRule.set(ruleId, [...(byRule.get(ruleId) ?? []), key]);
		}
		const failedKeys: string[] = [];
		const failedNames: string[] = [];
		let succeeded = 0;
		for (const [ruleId, keys] of byRule) {
			const view = (rules ?? []).find((r) => r.ruleId === ruleId);
			const fail = () => {
				failedKeys.push(...keys);
				failedNames.push(view?.name ?? ruleId);
			};
			if (!view) {
				fail();
				continue;
			}
			try {
				if (pending[`${ruleId}:upgrade`] === true) {
					const result = await upgradeRuleConfig({
						data: { org, repoId, ruleId },
					});
					if (result && "error" in result) {
						fail();
						continue;
					}
				}
				if (view.source === "custom") {
					const enabledKey = `${ruleId}:enabled`;
					if (enabledKey in pending) {
						const result = await setCustomRuleEnabled({
							data: {
								org,
								repoId,
								id: ruleId,
								enabled: pending[enabledKey] as boolean,
							},
						});
						if (result && "error" in result) {
							fail();
							continue;
						}
					}
					succeeded += 1;
					continue;
				}
				const paramKeys = keys.filter((k) => k.includes(":param:"));
				const enabledKey = `${ruleId}:enabled`;
				if (paramKeys.length > 0 || enabledKey in pending) {
					const config = { ...asObject(view.config) };
					for (const key of paramKeys) {
						const paramKey = key.split(":param:")[1] ?? "";
						const value = pending[key];
						if (value !== undefined) {
							config[paramKey] = value;
						}
					}
					const queuedEnabled = pending[enabledKey];
					const enabled =
						queuedEnabled === true
							? true
							: queuedEnabled === false
								? false
								: view.enabled;
					const result = await saveRuleConfig({
						data: { org, repoId, ruleId, enabled, config },
					});
					if (result && "error" in result) {
						fail();
						continue;
					}
				}
				succeeded += 1;
			} catch {
				fail();
			}
		}
		for (const [key, value] of Object.entries(pending)) {
			if (key.endsWith(":enabled") && !failedKeys.includes(key)) {
				trackEvent("rule_toggled", {
					rule: key.slice(0, -":enabled".length),
					enabled: Boolean(value),
				});
			}
		}
		if (succeeded > 0) {
			await queryClient.invalidateQueries({
				queryKey: rulesQueryKeys.config(org, repoId),
			});
		}
		if (failedKeys.length === 0) {
			toast.success("Rule changes saved");
			return { ok: true };
		}
		const message = `${failedNames.join(" and ")} did not save. Select Save changes to try again.`;
		toast.fail(message);
		return { error: message, failedKeys };
	};

	const removeCustomRule = async (ruleId: string) => {
		const result = await deleteCustomRule({
			data: { org, repoId, id: ruleId },
		});
		if (result && "error" in result) {
			throw new Error(result.error);
		}
		await queryClient.invalidateQueries({
			queryKey: rulesQueryKeys.config(org, repoId),
		});
		toast.success("Rule deleted");
	};

	const saveDraft = async (draft: CustomRuleDraft): Promise<string | null> => {
		const result = await saveCustomRule({
			data: {
				org,
				repoId,
				id: draft.id,
				name: draft.name,
				enabled: true,
				definition: draft.definition,
			},
		});
		if (result && "error" in result) {
			return result.error;
		}
		await queryClient.invalidateQueries({
			queryKey: rulesQueryKeys.config(org, repoId),
		});
		trackEvent("custom_rule_created", {});
		toast.success("Rule created");
		return null;
	};

	const library = libraryQuery.data;
	const preview = library?.preview ?? null;

	return (
		<SaveQueueProvider
			commit={commitBatch}
			isEqual={jsonEqual}
			savedValues={useMemo(() => ruleSavedValues(rules), [rules])}
		>
			<DashboardLayout counts={{}}>
				<Page purpose="task">
					<PageHeader
						actions={
							<>
								{repo?.forge === "github" && (
									<RepoModerationSettings
										canManage={isAdmin}
										key={repo.id}
										onBrowseLibrary={() => void showTab("library")}
										org={org}
										pilotEnabled={Boolean(!pilotManaged && pilot?.enabled)}
										repo={repoName}
										rules={rules}
									/>
								)}
								{isAdmin && (
									<Button
										onClick={() => setBuilderOpen(true)}
										variant="secondary"
									>
										<Icon icon={Add} />
										Create rule
									</Button>
								)}
							</>
						}
						description={
							starting
								? undefined
								: orgContext && !isAdmin
									? "Your role can view the rules for this repository."
									: "Manage the checks Tripwire runs on contributions to this repository."
						}
						title="Rules"
					/>
					<PageBody>
						<CustomRuleBuilder
							onClose={() => setBuilderOpen(false)}
							onSave={saveDraft}
							open={builderOpen}
							org={org}
							repoId={repoId}
						/>

						{repo && !repo.armed ? (
							<ArmCallout
								forge={repo.forge}
								org={org}
								repo={repoName}
								repoFullName={repo.fullName}
								variant="banner"
							/>
						) : null}

						{starting && repo ? (
							<>
								<RulePacks
									forge={repo.forge}
									canEdit={isAdmin}
									onInstall={install}
									pending={pending}
									preview={preview}
									rules={rules ?? []}
								/>
								<div>
									<Button
										onClick={() => showTab("library")}
										size="sm"
										variant="secondary"
									>
										Browse rules
									</Button>
								</div>
							</>
						) : (
							<>
								<SegmentedControl
									aria-label="Rules to show"
									onValueChange={(value) => {
										const next = RULES_TABS.find((t) => t === value);
										if (next) {
											showTab(next);
										}
									}}
									value={activeTab}
								>
									<SegmentedControlItem
										count={installed.length}
										value="installed"
									>
										Installed
									</SegmentedControlItem>
									<SegmentedControlItem count={libraryCount} value="library">
										Library
									</SegmentedControlItem>
									<SegmentedControlItem
										count={customRules.length}
										value="custom"
									>
										Custom
									</SegmentedControlItem>
								</SegmentedControl>

								{activeTab === "library" ? (
									rules === undefined ? (
										rulesQuery.isError ? (
											<Empty reason="error">
												<EmptyHeader>
													<EmptyTitle>Rules did not load</EmptyTitle>
													<EmptyDescription>
														Check your connection and try again.
													</EmptyDescription>
												</EmptyHeader>
												<EmptyContent>
													<EmptyRetry
														onRetry={async () => {
															await rulesQuery.refetch({ throwOnError: true });
														}}
													>
														Load rules again
													</EmptyRetry>
												</EmptyContent>
											</Empty>
										) : (
											<RuleGridSkeleton />
										)
									) : libraryCount === 0 ? (
										<Empty art={<MascotArt mood="rules-empty" />}>
											<EmptyHeader>
												<EmptyTitle>
													Every rule in the library is installed
												</EmptyTitle>
											</EmptyHeader>
										</Empty>
									) : (
										<RuleLibrary
											canEdit={isAdmin}
											mostUsed={library?.mostUsed ?? []}
											onInstall={install}
											pending={pending}
											pilot={
												pilotOffered ? (
													<PilotLibraryRow
														canEdit={isAdmin}
														pending={savingPilot}
														onInstall={() => setPilotInstalled(true)}
													/>
												) : null
											}
											preview={preview}
											rules={rules}
										/>
									)
								) : (
									<>
										{activeTab === "installed" ? (
											<RuleHeaderStats stats={statsQuery.data} />
										) : null}
										<Collection
											collection={collection}
											empty={
												activeTab === "custom" ? (
													<Empty
														art={<MascotArt mood="rules-custom-empty" />}
														className="relative isolate overflow-hidden"
													>
														<ShaderDither
															className="-z-10 bottom-auto h-30"
															priority={1}
														/>
														<EmptyHeader>
															<EmptyTitle>No custom rules yet</EmptyTitle>
															<EmptyDescription>
																{isAdmin
																	? "A custom rule checks contributors and their changes against conditions you pick."
																	: "Custom rules check for patterns specific to this repo. An org admin creates them."}
															</EmptyDescription>
														</EmptyHeader>
														{isAdmin ? (
															<EmptyContent>
																<Button
																	onClick={() => setBuilderOpen(true)}
																	size="sm"
																	variant="secondary"
																>
																	Create rule
																</Button>
															</EmptyContent>
														) : null}
													</Empty>
												) : (
													<Empty art={<MascotArt mood="rules-empty" />}>
														<EmptyHeader>
															<EmptyTitle>No rules installed</EmptyTitle>
														</EmptyHeader>
														<EmptyContent>
															<Button
																onClick={() => showTab("library")}
																size="sm"
																variant="secondary"
															>
																Browse rules
															</Button>
														</EmptyContent>
													</Empty>
												)
											}
											error={rulesQuery.isError}
											onRetry={async () => {
												await rulesQuery.refetch({ throwOnError: true });
											}}
											skeleton={<RuleGridSkeleton />}
										>
											{(visible) => (
												<div className="grid items-stretch gap-3 sm:grid-cols-2">
													{visible.map((rule) =>
														"kind" in rule ? (
															<SharedBlocklistRuleCard
																canEdit={isAdmin}
																key={rule.ruleId}
																highlighted={pilotHighlighted}
																pending={savingPilot}
																onUninstall={() => setPilotInstalled(false)}
															/>
														) : (
															<RuleCard
																canEdit={isAdmin}
																key={rule.ruleId}
																onDelete={removeCustomRule}
																org={org}
																repo={repoName}
																rule={rule}
															/>
														),
													)}
												</div>
											)}
										</Collection>
									</>
								)}
							</>
						)}
					</PageBody>
				</Page>
				<UnsavedChangesBar />
			</DashboardLayout>
		</SaveQueueProvider>
	);
}
