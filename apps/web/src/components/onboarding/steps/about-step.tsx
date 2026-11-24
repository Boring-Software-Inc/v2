import {
	ONBOARDING_REFERRALS,
	ONBOARDING_ROLES,
	ONBOARDING_TEAM_SIZES,
	ONBOARDING_USAGES,
	type OnboardingReferral,
	type OnboardingRole,
	type OnboardingTeamSize,
	type OnboardingUsage,
} from "@tripwire/contracts";
import { Button } from "@tripwire/ui/button";
import {
	BlueskyMark,
	DiscordMark,
	GithubMark,
	Icon,
	type IconGlyph,
	LinkedinMark,
	Members,
	RedditMark,
	XMark,
	YoutubeMark,
} from "@tripwire/ui/icon";
import { SegmentedControl } from "@tripwire/ui/radio-group";
import { ChoiceGrid } from "#/components/onboarding/choice-grid";
import {
	ONBOARDING_COPY,
	REFERRAL_COPY,
	ROLE_COPY,
	TEAM_SIZE_COPY,
	USAGE_COPY,
} from "#/components/onboarding/onboarding-copy";
import { useOnboardingDraft } from "#/components/onboarding/onboarding-draft";
import { OnboardingStepHeader } from "#/components/onboarding/onboarding-frame";
import type { StepViewProps } from "#/components/onboarding/onboarding-steps";

const copy = ONBOARDING_COPY.about;

const REFERRAL_MARKS = {
	x: XMark,
	github: GithubMark,
	"hacker-news": "hn",
	reddit: RedditMark,
	bluesky: BlueskyMark,
	youtube: YoutubeMark,
	discord: DiscordMark,
	linkedin: LinkedinMark,
	friend: Members,
} satisfies Record<OnboardingReferral, IconGlyph | "hn">;

function referralIcon(referral: OnboardingReferral) {
	const mark = REFERRAL_MARKS[referral];
	return mark === "hn" ? (
		<span data-part="hn">
			<span>Y</span>
		</span>
	) : (
		<Icon icon={mark} size={14} />
	);
}

/** Step 2: who they are, which sets how strict Tripwire starts. */
export function AboutStep({ flow }: StepViewProps) {
	const [draft, update] = useOnboardingDraft();
	const ready =
		draft.usage !== null && draft.role !== null && draft.teamSize !== null;
	return (
		<>
			<OnboardingStepHeader
				current={flow.step}
				steps={flow.steps}
				sub={copy.sub}
				title={copy.title}
			/>
			<div data-layout-role="onboarding-fields">
				<fieldset data-layout-role="onboarding-field">
					<legend data-layout-role="onboarding-field-legend">
						<span>{copy.usage}</span>
					</legend>
					<SegmentedControl
						ariaLabel={copy.usage}
						fill
						onValueChange={(value) =>
							update({ usage: value as OnboardingUsage | null })
						}
						options={ONBOARDING_USAGES.map((usage) => ({
							label: USAGE_COPY[usage],
							value: usage,
						}))}
						value={draft.usage}
					/>
				</fieldset>
				<ChoiceGrid<OnboardingRole>
					legend={copy.role}
					name="role"
					onChange={(role) => update({ role })}
					options={ONBOARDING_ROLES.map((role) => ({
						label: ROLE_COPY[role],
						value: role,
					}))}
					value={draft.role}
				/>
				<fieldset data-layout-role="onboarding-field">
					<legend data-layout-role="onboarding-field-legend">
						<span>{copy.teamSize}</span>
					</legend>
					<SegmentedControl
						ariaLabel={copy.teamSize}
						fill
						onValueChange={(value) =>
							update({ teamSize: value as OnboardingTeamSize | null })
						}
						options={ONBOARDING_TEAM_SIZES.map((size) => ({
							label: TEAM_SIZE_COPY[size],
							value: size,
						}))}
						value={draft.teamSize}
					/>
				</fieldset>
				<ChoiceGrid<OnboardingReferral>
					hint={copy.optional}
					legend={copy.referral}
					name="referral"
					onChange={(referral) => update({ referral })}
					options={ONBOARDING_REFERRALS.map((referral) => ({
						icon: referralIcon(referral),
						label: REFERRAL_COPY[referral],
						value: referral,
					}))}
					value={draft.referral}
				/>
			</div>
			<Button
				disabled={!ready}
				onAction={() =>
					flow.advance({
						org:
							draft.usage === "personal"
								? flow.state.personalOrgSlug
								: undefined,
						answers: {
							usage: draft.usage,
							role: draft.role,
							teamSize: draft.teamSize,
							referral: draft.referral,
						},
					})
				}
				size="large"
				variant="primary"
			>
				{ONBOARDING_COPY.continue}
			</Button>
		</>
	);
}
