import { useQuery } from "@tanstack/react-query";
import type { OnboardingRepo } from "@tripwire/contracts";
import { Button } from "@tripwire/ui/button";
import { Add, Icon } from "@tripwire/ui/icon";
import { SegmentedControl } from "@tripwire/ui/radio-group";
import { useMemo } from "react";
import { Collection } from "#/components/collection/collection";
import {
	EmptyState,
	EmptyStateContent,
	EmptyStateHeader,
	EmptyStateTitle,
} from "#/components/common/empty-state";
import { Page, PageBody, PageHeader } from "#/components/layouts/page";
import { MascotArt } from "#/components/mascot/mascot-art";
import { PreviewApp } from "#/components/onboarding/preview/preview-app";
import { RepoModerationSettings } from "#/components/rules/repo-moderation-settings";
import { RuleCard } from "#/components/rules/rule-card";
import { RuleHeaderStats } from "#/components/rules/rule-header-stats";
import { libraryRules } from "#/components/rules/rule-library";
import { RULES_COLLECTION } from "#/components/rules/rules-collection";
import { RuleGridSkeleton } from "#/components/rules/rules-page-skeleton";
import { SaveQueueProvider } from "#/components/save-queue/save-queue-context";
import { useCollection } from "#/hooks/use-collection";
import {
	ruleConfigsQueryOptions,
	rulesStatsQueryOptions,
} from "#/lib/rules.query";

const NO_SAVED_VALUES = {};
/** The preview never saves; the step installs the rules for real. */
const noCommit = async () => ({ ok: true }) as const;

/**
 * The repo's Rules page as it will look with the picked rules installed: the
 * repo's real rule list with the picks switched on, through the page's own
 * header, tabs, stats, collection and cards. Picks fill in as they change.
 */
export function RulesPreviewPage({
	org,
	repo,
	ruleIds,
}: {
	org: string;
	repo: OnboardingRepo | null;
	ruleIds: readonly string[];
}) {
	const repoId = repo?.id ?? "";
	const rulesQuery = useQuery(ruleConfigsQueryOptions(org, repoId));
	const statsQuery = useQuery(rulesStatsQueryOptions(org, repoId));
	const rules = useMemo(
		() =>
			rulesQuery.data?.map((rule) =>
				rule.source === "built-in"
					? { ...rule, enabled: ruleIds.includes(rule.ruleId) }
					: rule,
			),
		[rulesQuery.data, ruleIds],
	);
	const installed = (rules ?? []).filter((rule) => rule.enabled);
	const custom = (rules ?? []).filter((rule) => rule.source === "custom");
	const collection = useCollection(
		RULES_COLLECTION,
		rules === undefined ? undefined : installed,
		{ store: "local" },
	);
	const forge = repo?.forge;

	return (
		<PreviewApp
			active="rules"
			forge={forge}
			repo={repo?.name ?? null}
			url={{
				host: "app.tripwire.sh",
				path: repo ? `/${org}/${repo.name}/rules` : `/${org}/home`,
			}}
		>
			<SaveQueueProvider commit={noCommit} savedValues={NO_SAVED_VALUES}>
				<Page purpose="task">
					<PageHeader
						actions={
							<>
								{repo && (forge === "github" || forge === "gitcafe") ? (
									<RepoModerationSettings
										canManage
										org={org}
										repo={repo.name}
									/>
								) : null}
								<Button variant="secondary">
									<Icon icon={Add} />
									Create rule
								</Button>
							</>
						}
						description="Manage the checks Tripwire runs on contributions to this repository."
						title="Rules"
					/>
					<PageBody>
						<div data-layout-role="rules-view-control">
							<SegmentedControl
								ariaLabel="Rules to show"
								options={[
									{
										count: installed.length,
										label: "Installed",
										value: "installed",
									},
									{
										count: libraryRules(rules ?? []).length,
										label: "Library",
										value: "library",
									},
									{ count: custom.length, label: "Custom", value: "custom" },
								]}
								readOnly
								value="installed"
							/>
						</div>
						<RuleHeaderStats stats={statsQuery.data} />
						<Collection
							collection={collection}
							empty={
								<EmptyState art={<MascotArt mood="rules-empty" />}>
									<EmptyStateHeader>
										<EmptyStateTitle>No rules installed</EmptyStateTitle>
									</EmptyStateHeader>
									<EmptyStateContent>
										<Button size="small" variant="secondary">
											Browse rules
										</Button>
									</EmptyStateContent>
								</EmptyState>
							}
							skeleton={<RuleGridSkeleton />}
						>
							{(visible) => (
								<div data-layout-role="onboarding-rule-grid">
									{visible.map((rule) => (
										<RuleCard
											canEdit
											key={rule.ruleId}
											org={org}
											repo={repo?.name ?? ""}
											rule={rule}
										/>
									))}
								</div>
							)}
						</Collection>
					</PageBody>
				</Page>
			</SaveQueueProvider>
		</PreviewApp>
	);
}
