import { useMutation } from "@tanstack/react-query";
import {
	type ForgeId,
	ONBOARDING_RULE_PICKS,
	type OnboardingRulePick,
	RULE_CATALOG,
	recommendedRulePicks,
	ruleSupportsForge,
} from "@tripwire/contracts";
import { Button } from "@tripwire/ui/button";
import { Check, Icon } from "@tripwire/ui/icon";
import { Switch } from "@tripwire/ui/switch";
import { useMemo } from "react";
import {
	INTENT_COPY,
	ONBOARDING_COPY,
	PICK_COPY,
} from "#/components/onboarding/onboarding-copy";
import { useOnboardingDraft } from "#/components/onboarding/onboarding-draft";
import { OnboardingStepHeader } from "#/components/onboarding/onboarding-frame";
import type { StepViewProps } from "#/components/onboarding/onboarding-steps";
import { RulesPreviewPage } from "#/components/onboarding/preview/rules-preview";
import { setRulesEnabled } from "#/lib/rules.functions";

const copy = ONBOARDING_COPY.rules;

/** The picks this repo can run, the recommended ones first, and what is on. */
function useRulePicks(flow: StepViewProps["flow"]) {
	const [draft] = useOnboardingDraft();
	const forge: ForgeId = flow.state.repo?.forge ?? "github";
	return useMemo(() => {
		const supported = (pick: OnboardingRulePick) =>
			pick.ruleIds.filter((ruleId) => ruleSupportsForge(ruleId, forge));
		const available = ONBOARDING_RULE_PICKS.filter(
			(pick) => supported(pick).length > 0,
		);
		const recommended = recommendedRulePicks(flow.state.answers.intents).filter(
			(pick) => available.includes(pick),
		);
		const optional = available.filter((pick) => !recommended.includes(pick));
		const on = draft.picks ?? recommended.map((pick) => pick.id);
		const ruleIds = available
			.filter((pick) => on.includes(pick.id))
			.flatMap(supported);
		return { recommended, optional, on, ruleIds };
	}, [draft.picks, flow.state.answers.intents, forge]);
}

/**
 * Step 5: the rules to start with. Picks that match their answers come on by
 * default; installing them turns them on as standalone rules, which block.
 */
export function RulesStep({ flow }: StepViewProps) {
	const [, update] = useOnboardingDraft();
	const { recommended, optional, on, ruleIds } = useRulePicks(flow);
	const org = flow.state.orgSlug ?? flow.state.personalOrgSlug ?? "";
	const repo = flow.state.repo;
	const install = useMutation({
		mutationFn: async () => {
			if (!repo || ruleIds.length === 0) {
				return;
			}
			const result = await setRulesEnabled({
				data: { org, repoId: repo.id, ruleIds, enabled: true },
			});
			if ("error" in result) {
				throw new Error(result.error);
			}
		},
		onSuccess: () => flow.advance({ answers: { ruleIds } }),
	});
	const toggle = (pickId: string, checked: boolean) =>
		update({
			picks: checked ? [...on, pickId] : on.filter((id) => id !== pickId),
		});
	const reasonFor = (pick: OnboardingRulePick) => {
		const intent = pick.intents.find((item) =>
			flow.state.answers.intents.includes(item),
		);
		return intent ? copy.pickFor(INTENT_COPY[intent].name) : null;
	};

	return (
		<>
			<OnboardingStepHeader
				current={flow.step}
				steps={flow.steps}
				sub={copy.sub}
				title={copy.title}
			/>
			<div data-layout-role="onboarding-fields">
				{recommended.length > 0 ? (
					<section
						aria-label={copy.forYourPicks}
						data-layout-role="onboarding-picks"
					>
						<span data-layout-role="onboarding-field-legend">
							<span>{copy.forYourPicks}</span>
						</span>
						{recommended.map((pick) => {
							const reason = reasonFor(pick);
							return (
								<div data-layout-role="onboarding-pick-card" key={pick.id}>
									<div data-part="panel">
										<Switch
											checked={on.includes(pick.id)}
											description={PICK_COPY[pick.id]?.desc}
											label={PICK_COPY[pick.id]?.name ?? pick.id}
											onCheckedChange={(checked) => toggle(pick.id, checked)}
										/>
									</div>
									{reason ? (
										<span data-part="reason">
											<Icon icon={Check} size={12} />
											{reason}
										</span>
									) : null}
								</div>
							);
						})}
					</section>
				) : null}
				{optional.length > 0 ? (
					<section
						aria-label={copy.optional}
						data-layout-role="onboarding-picks"
					>
						<span data-layout-role="onboarding-field-legend">
							<span>{copy.optional}</span>
						</span>
						{optional.map((pick) => (
							<div data-layout-role="onboarding-pick-row" key={pick.id}>
								<Switch
									checked={on.includes(pick.id)}
									description={PICK_COPY[pick.id]?.desc}
									label={PICK_COPY[pick.id]?.name ?? pick.id}
									onCheckedChange={(checked) => toggle(pick.id, checked)}
								/>
							</div>
						))}
					</section>
				) : null}
			</div>
			{install.isError ? (
				<p data-layout-role="onboarding-error" role="alert">
					{ONBOARDING_COPY.saveFailed}
				</p>
			) : null}
			<Button
				onAction={() => install.mutate()}
				pending={install.isPending}
				size="large"
				variant="primary"
			>
				{copy.install(ruleIds.length)}
			</Button>
		</>
	);
}

export function RulesPreview({ flow }: StepViewProps) {
	const { ruleIds } = useRulePicks(flow);
	const org = flow.state.orgSlug ?? flow.state.personalOrgSlug ?? "";
	const known = new Set<string>(RULE_CATALOG.map((rule) => rule.ruleId));
	return (
		<RulesPreviewPage
			org={org}
			repo={flow.state.repo}
			ruleIds={ruleIds.filter((ruleId) => known.has(ruleId))}
		/>
	);
}
