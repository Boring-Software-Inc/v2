import { ONBOARDING_STEPS } from "@tripwire/contracts";
import { AlertDialog } from "@tripwire/ui/dialog";
import { ONBOARDING_COPY } from "#/components/onboarding/onboarding-copy";
import type { useOnboardingFlow } from "#/components/onboarding/use-onboarding-flow";

/** Steps after this one have changed the workspace, so skipping asks first. */
const CONFIRM_FROM = ONBOARDING_STEPS.indexOf("connect");

/**
 * "Skip setup" clears the onboarding requirement and lands the user in their
 * workspace. Once they have started connecting repos it asks first, because
 * the rest of the setup is left half done.
 */
export function SkipSetup({
	flow,
	label,
}: {
	flow: ReturnType<typeof useOnboardingFlow>;
	label: string;
}) {
	// Step 1 has its own Skip for the question; skipping setup starts at step 2.
	if (flow.step === "problems") {
		return null;
	}
	const skip = () => flow.finish("skipped");
	const trigger = (
		<button
			data-layout-role="onboarding-skip"
			disabled={flow.finishing}
			type="button"
		>
			{label}
		</button>
	);
	if (ONBOARDING_STEPS.indexOf(flow.step) < CONFIRM_FROM) {
		return (
			<button
				data-layout-role="onboarding-skip"
				disabled={flow.finishing}
				onClick={skip}
				type="button"
			>
				{label}
			</button>
		);
	}
	return (
		<AlertDialog
			confirmLabel={ONBOARDING_COPY.skipConfirm.action}
			description={ONBOARDING_COPY.skipConfirm.body}
			onConfirm={skip}
			title={ONBOARDING_COPY.skipConfirm.title}
			trigger={trigger}
		/>
	);
}
