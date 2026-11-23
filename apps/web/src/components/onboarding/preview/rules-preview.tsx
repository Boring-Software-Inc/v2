import {
	jsonValueSchema,
	type OnboardingRepo,
	RULE_CATALOG,
} from "@tripwire/contracts";
import { SegmentedControl } from "@tripwire/ui/radio-group";
import { Page, PageBody, PageHeader } from "#/components/layouts/page";
import { PreviewApp } from "#/components/onboarding/preview/preview-app";
import { RuleCard } from "#/components/rules/rule-card";
import { SaveQueueProvider } from "#/components/save-queue/save-queue-context";
import type { RuleConfigView } from "#/lib/rules.functions";

const NO_SAVED_VALUES = {};
/** The preview never saves; the step installs the rules for real. */
const noCommit = async () => ({ ok: true }) as const;

/** A just-installed standalone rule as the Rules page lists it. */
function installedView(ruleId: string): RuleConfigView | null {
	const entry = RULE_CATALOG.find((rule) => rule.ruleId === ruleId);
	if (!entry) {
		return null;
	}
	const config = jsonValueSchema.parse(entry.defaultConfig);
	return {
		ruleId,
		forgeBlockReason: null,
		unavailableReason: null,
		version: entry.version,
		held: false,
		changeNote: null,
		name: entry.name,
		blurb: entry.blurb,
		enabled: true,
		config,
		defaultConfig: config,
		management: "standalone",
		workflowId: null,
		optIn: false,
		matches24h: 0,
		trend: [],
		source: "built-in",
		sentence: null,
		blockingWorkflows: [],
		usedIn: [],
	};
}

/**
 * The repo's Rules page with the picked rules installed: the real rule cards,
 * filling in as picks are switched on and off.
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
	const rules = ruleIds.flatMap((ruleId) => installedView(ruleId) ?? []);
	return (
		<PreviewApp
			active="rules"
			forge={repo?.forge}
			repo={repo?.fullName ?? null}
			url={{
				host: "app.tripwire.sh",
				path: repo ? `/${org}/${repo.name}/rules` : `/${org}/home`,
			}}
		>
			<SaveQueueProvider commit={noCommit} savedValues={NO_SAVED_VALUES}>
				<Page purpose="task">
					<PageHeader
						description="Manage the checks Tripwire runs on contributions to this repository."
						title="Rules"
					/>
					<PageBody>
						<div data-layout-role="rules-view-control">
							<SegmentedControl
								ariaLabel="Rules to show"
								options={[
									{
										count: rules.length,
										label: "Installed",
										value: "installed",
									},
									{ label: "Library", value: "library" },
									{ label: "Custom", value: "custom" },
								]}
								readOnly
								value="installed"
							/>
						</div>
						<div data-layout-role="onboarding-rule-grid">
							{rules.map((rule) => (
								<RuleCard
									canEdit
									key={rule.ruleId}
									org={org}
									repo={repo?.name ?? ""}
									rule={rule}
								/>
							))}
						</div>
					</PageBody>
				</Page>
			</SaveQueueProvider>
		</PreviewApp>
	);
}
