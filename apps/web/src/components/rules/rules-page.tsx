import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { ruleUiSchema } from "@tripwire/contracts";
import { useMemo, useState } from "react";
import { ArmCallout } from "#/components/arming/arm-callout";
import { Collection } from "#/components/collection/collection";
import { ShaderDither } from "#/components/dither/shader-dither";
import { Add, Icon } from "#/components/glaze/icon";
import { Button } from "#/components/glaze/ui/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "#/components/glaze/ui/empty-state";
import { toast } from "#/components/glaze/ui/toast";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { MascotArt } from "#/components/mascot/mascot-art";
import {
	CustomRuleBuilder,
	type CustomRuleDraft,
} from "#/components/rules/custom-rule-builder";
import { RuleCard } from "#/components/rules/rule-card";
import { RuleHeaderStats } from "#/components/rules/rule-header-stats";
import { RULES_COLLECTION } from "#/components/rules/rules-collection";
import { RuleGridSkeleton } from "#/components/rules/rules-page-skeleton";
import {
	type SaveQueueCommit,
	SaveQueueProvider,
	UnsavedChangesBar,
} from "#/components/save-queue";
import { useCollection } from "#/hooks/use-collection";
import { useOrgPermission } from "#/hooks/use-org-permission";
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
	rulesQueryKeys,
	rulesStatsQueryOptions,
} from "#/lib/rules.query";
import { trackEvent } from "#/lib/track";
import { workflowBannerCopy } from "#/lib/workflow-banner-copy";

const routeApi = getRouteApi("/$org/$repo/rules");

/** Deep equality for the queue's noop-clearing — rule param values include
 * arrays (honeypot paths), where ordering IS a real change. */
function jsonEqual(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

const asObject = (c: unknown): Record<string, unknown> =>
	typeof c === "object" && c !== null ? (c as Record<string, unknown>) : {};

/**
 * The queue's saved baseline: per STANDALONE rule, `${ruleId}:enabled`, one
 * `${ruleId}:param:${key}` per param (falling back to the param default the
 * sentence displays), and `${ruleId}:upgrade` (false) when an update is held.
 * Managed rules contribute no keys — their cards are read-only.
 */
function ruleSavedValues(
	rules: RuleConfigView[] | undefined,
): Record<string, unknown> {
	const values: Record<string, unknown> = {};
	for (const rule of rules ?? []) {
		if (rule.management !== "standalone") {
			continue;
		}
		values[`${rule.ruleId}:enabled`] = rule.enabled;
		const config = asObject(rule.config);
		for (const param of ruleUiSchema(rule.ruleId)?.params ?? []) {
			values[`${rule.ruleId}:param:${param.key}`] =
				config[param.key] ?? ("default" in param ? param.default : undefined);
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
	const rules = rulesQuery.data;
	const statsQuery = useQuery(rulesStatsQueryOptions(org, repoId));
	const queryClient = useQueryClient();

	const collection = useCollection(RULES_COLLECTION, rules);
	const show = collection.state.filters.show?.[0];
	const managedNames = (rules ?? [])
		.filter((r) => r.management === "managed")
		.map((r) => r.name);
	const hasCustom = (rules ?? []).some((r) => r.source === "custom");

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
						config[paramKey] = pending[key];
					}
					const enabled =
						(pending[enabledKey] as boolean | undefined) ?? view.enabled;
					const result = await saveRuleConfig({
						data: { org, repoId, ruleId, enabled, config: config as never },
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

	return (
		<SaveQueueProvider
			commit={commitBatch}
			isEqual={jsonEqual}
			savedValues={useMemo(() => ruleSavedValues(rules), [rules])}
		>
			<DashboardLayout counts={{}}>
				<div className="px-4 py-6 md:px-8 md:py-10">
					<div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
						<header className="flex items-start justify-between gap-4">
							<div className="flex flex-col gap-1">
								<h1 className="type-title">Rules</h1>
								<p className="type-body text-text-2">
									Requirements that every contributor outside your org must meet
									on every change request.
								</p>
								{orgContext && !isAdmin ? (
									<p className="type-body-sm text-text-2">
										Your role can view rules but not change them.
									</p>
								) : null}
							</div>
							{isAdmin ? (
								<Button onClick={() => setBuilderOpen(true)}>
									<Icon icon={Add} />
									Create rule
								</Button>
							) : null}
						</header>
						<CustomRuleBuilder
							onClose={() => setBuilderOpen(false)}
							onSave={saveDraft}
							open={builderOpen}
							org={org}
							repoId={repoId}
						/>

						{repo && !repo.armed ? (
							<ArmCallout
								org={org}
								repo={repoName}
								repoFullName={repo.fullName}
								variant="banner"
							/>
						) : null}

						<RuleHeaderStats stats={statsQuery.data} />

						<Collection
							collection={collection}
							empty={
								<Empty art={<MascotArt mood="rules-empty" />}>
									<EmptyHeader>
										<EmptyTitle>No rules yet</EmptyTitle>
										<EmptyDescription>
											{isAdmin
												? "This repo has no rules. Create one to start checking change requests."
												: "This repo has no rules. An org admin can create them."}
										</EmptyDescription>
									</EmptyHeader>
									<EmptyContent>
										{isAdmin ? (
											<Button
												onClick={() => setBuilderOpen(true)}
												size="sm"
												variant="secondary"
											>
												Create rule
											</Button>
										) : (
											<Button
												nativeButton={false}
												render={
													<Link
														params={{ org, repo: repoName }}
														to="/$org/$repo/activity"
													/>
												}
												size="sm"
												variant="secondary"
											>
												View activity
											</Button>
										)}
									</EmptyContent>
								</Empty>
							}
							error={rulesQuery.isError}
							noResults={
								show === "custom" && !hasCustom && !collection.state.q ? (
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
										<EmptyContent>
											{isAdmin ? (
												<Button
													onClick={() => setBuilderOpen(true)}
													size="sm"
													variant="secondary"
												>
													Create rule
												</Button>
											) : (
												<Button
													onClick={collection.clear}
													size="sm"
													variant="secondary"
												>
													Show all rules
												</Button>
											)}
										</EmptyContent>
									</Empty>
								) : undefined
							}
							onRetry={async () => {
								await rulesQuery.refetch({ throwOnError: true });
							}}
							skeleton={<RuleGridSkeleton />}
						>
							{(visible) => (
								<>
									{managedNames.length > 0 &&
									(show === undefined || show === "workflows") ? (
										<p className="type-body-sm text-text-2">
											{workflowBannerCopy(managedNames)}
										</p>
									) : null}
									<div className="grid items-stretch gap-3 sm:grid-cols-2">
										{visible.map((rule) => (
											<RuleCard
												canEdit={isAdmin}
												key={rule.ruleId}
												onDelete={removeCustomRule}
												org={org}
												repo={repoName}
												rule={rule}
											/>
										))}
									</div>
								</>
							)}
						</Collection>
					</div>
				</div>
				<UnsavedChangesBar />
			</DashboardLayout>
		</SaveQueueProvider>
	);
}
