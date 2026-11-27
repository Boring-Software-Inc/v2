import { onboardingStepSchema } from "@tripwire/contracts";
import { z } from "zod";

/** `/onboarding?step=`: an unknown step falls back to the saved one. */
export const onboardingSearchSchema = z.object({
	step: onboardingStepSchema.optional().catch(undefined),
});
