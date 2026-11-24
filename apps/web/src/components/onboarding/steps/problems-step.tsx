import { ONBOARDING_INTENTS, type OnboardingIntent } from "@tripwire/contracts";
import { Button } from "@tripwire/ui/button";
import { Caption, Label, SupportingText } from "@tripwire/ui/typography";
import {
	INTENT_COPY,
	ONBOARDING_COPY,
} from "#/components/onboarding/onboarding-copy";
import { useOnboardingDraft } from "#/components/onboarding/onboarding-draft";
import { OnboardingStepHeader } from "#/components/onboarding/onboarding-frame";
import type { StepViewProps } from "#/components/onboarding/onboarding-steps";

const copy = ONBOARDING_COPY.problems;

/**
 * Step 1: what has been getting through. Each pick is a toggle; the picks
 * decide which rule packs the rules step recommends.
 */
export function ProblemsStep({ flow }: StepViewProps) {
	const [draft, update] = useOnboardingDraft();
	const toggle = (intent: OnboardingIntent) =>
		update({
			intents: draft.intents.includes(intent)
				? draft.intents.filter((item) => item !== intent)
				: ONBOARDING_INTENTS.filter(
						(item) => item === intent || draft.intents.includes(item),
					),
		});
	return (
		<>
			<OnboardingStepHeader
				current={flow.step}
				steps={flow.steps}
				sub={copy.sub}
				title={copy.title}
			/>
			<div data-layout-role="onboarding-tiles">
				{ONBOARDING_INTENTS.map((intent) => (
					<button
						aria-pressed={draft.intents.includes(intent)}
						data-layout-role="onboarding-tile"
						key={intent}
						onClick={() => toggle(intent)}
						type="button"
					>
						<span aria-hidden="true" data-intent={intent} data-part="art" />
						<span data-part="text">
							<Label as="div">{INTENT_COPY[intent].name}</Label>
							<SupportingText as="span">
								{INTENT_COPY[intent].desc}
							</SupportingText>
						</span>
					</button>
				))}
			</div>
			<footer data-layout-role="onboarding-footer">
				<Caption>{copy.selected(draft.intents.length)}</Caption>
				<div data-layout-role="onboarding-footer-actions">
					<Button
						onAction={() => flow.advance({ answers: { intents: [] } })}
						variant="ghost"
					>
						{ONBOARDING_COPY.skip}
					</Button>
					<Button
						disabled={draft.intents.length === 0}
						onAction={() =>
							flow.advance({ answers: { intents: draft.intents } })
						}
						variant="primary"
					>
						{ONBOARDING_COPY.continue}
					</Button>
				</div>
			</footer>
		</>
	);
}
