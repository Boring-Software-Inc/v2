import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { ruleUiSchema } from "@tripwire/contracts";
import { useMemo, useRef, useState } from "react";
import { ArmCallout } from "#/components/arming/arm-callout";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { RuleCard } from "#/components/rules/rule-card";
import { RuleFilters, type RuleSort } from "#/components/rules/rule-filters";
import { RuleHeaderStats } from "#/components/rules/rule-header-stats";
import {
	type SaveQueueCommit,
	SaveQueueProvider,
	UnsavedChangesBar,
} from "#/components/save-queue";
import { toast } from "#/components/ui/toast";
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
	const isAdmin = orgContext?.role === "admin";
	const [sort, setSort] = useState<RuleSort>("active");
	const repoId = repo?.id ?? "";
	const { data: rules } = useQuery(ruleConfigsQueryOptions(org, repoId));
	const statsQuery = useQuery(rulesStatsQueryOptions(org, repoId));
	const queryClient = useQueryClient();

	const fetchedStats = useRef(false);
	if (statsQuery.isLoading) {
		fetchedStats.current = true;
	}

	const sorted = useMemo(() => {
		if (!rules) {
			return [];
		}
		const copy = [...rules];
		copy.sort((a, b) =>
			sort === "az"
				? a.name.localeCompare(b.name)
				: b.matches24h - a.matches24h || a.name.localeCompare(b.name),
		);
		return copy;
	}, [rules, sort]);

	// Management is per-rule (§6 — workflows compose with standalone rules). The
	// banner explains the split; per-card affordances act.
	const hasEnabledWorkflow = sorted.some((r) => r.management === "managed");
	const ownedRuleNames = sorted
		.filter((r) => r.management === "managed")
		.map((r) => r.name);

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
		if (succeeded > 0) {
			await queryClient.invalidateQueries({
				queryKey: rulesQueryKeys.config(org, repoId),
			});
		}
		if (failedKeys.length === 0) {
			toast("changes saved.");
			return { ok: true };
		}
		const message = `${failedNames.join(" and ")} did not save. save again to retry.`;
		toast(message);
		return { error: message, failedKeys };
	};

	return (
		<SaveQueueProvider
			commit={commitBatch}
			isEqual={jsonEqual}
			savedValues={useMemo(() => ruleSavedValues(rules), [rules])}
		>
			<DashboardLayout counts={{}}>
				<div className="mx-auto w-full max-w-4xl px-6 py-8">
					<header className="mb-6">
						<h1 className="font-semibold text-2xl tracking-tight">Rules</h1>
						<p className="text-muted-foreground text-sm">
							boolean requirements every non-exempt contributor must meet on
							every change request.
						</p>
					</header>

					{repo && !repo.armed ? (
						<ArmCallout
							className="mb-6"
							org={org}
							repo={repoName}
							repoFullName={repo.fullName}
							variant="banner"
						/>
					) : null}

					<div className="flex flex-col gap-6">
						{hasEnabledWorkflow ? (
							<div className="rounded-lg border bg-surface-1 px-4 py-2.5">
								<p className="text-muted-foreground text-xs">
									{workflowBannerCopy(ownedRuleNames)}
								</p>
							</div>
						) : null}
						{statsQuery.data ? (
							<RuleHeaderStats
								animate={fetchedStats.current}
								stats={statsQuery.data}
							/>
						) : null}
						{statsQuery.data && statsQuery.data.matches24h.value === 0 ? (
							<p className="rounded-lg border border-dashed px-4 py-3 text-center text-muted-foreground text-xs">
								no change requests evaluated in the last 24h — these rules take
								effect on the next one that opens.
							</p>
						) : null}
						<div className="flex items-center justify-end">
							<RuleFilters onSortChange={setSort} sort={sort} />
						</div>
						<div className="flex flex-col gap-3">
							{sorted.map((rule) => (
								<RuleCard
									canEdit={isAdmin}
									key={rule.ruleId}
									org={org}
									repo={repoName}
									rule={rule}
								/>
							))}
						</div>
					</div>
				</div>
				<UnsavedChangesBar />
			</DashboardLayout>
		</SaveQueueProvider>
	);
}
