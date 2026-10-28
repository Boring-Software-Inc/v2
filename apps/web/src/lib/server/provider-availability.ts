import { installUrlFor } from "@tripwire/auth/install-state";
import { configuredSignInProviderIds } from "@tripwire/auth/server";
import {
	type ProviderAvailability,
	providerAvailabilitySchema,
} from "@tripwire/contracts";
import { getAuth } from "#/lib/server/auth";

/** GitCafe needs installation readiness; existing OAuth providers keep their registered availability. */
export async function readProviderAvailability(): Promise<ProviderAvailability> {
	const auth = getAuth();
	const registered = await configuredSignInProviderIds(auth);
	const configured = registered.filter(
		(forge) =>
			forge !== "gitcafe" ||
			installUrlFor(
				forge,
				"",
				process.env.GITHUB_APP_SLUG,
				process.env.GITCAFE_APP_SLUG,
			).status === "ready",
	);
	return providerAvailabilitySchema.parse({ available: configured });
}
