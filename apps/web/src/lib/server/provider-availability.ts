import { installUrlFor } from "@tripwire/auth/install-state";
import { configuredSignInProviderIds } from "@tripwire/auth/server";
import {
	type ProviderAvailability,
	providerAvailabilitySchema,
} from "@tripwire/contracts";
import { getAuth } from "#/lib/server/auth";

/** Configuration and initialized registration are evaluated together for every advertised action. */
export async function readProviderAvailability(): Promise<ProviderAvailability> {
	const auth = getAuth();
	const registered = await configuredSignInProviderIds(auth);
	const configured = registered.filter(
		(forge) =>
			installUrlFor(
				forge,
				"",
				process.env.GITHUB_APP_SLUG,
				process.env.GITCAFE_APP_SLUG,
			).status === "ready",
	);
	return providerAvailabilitySchema.parse({ available: configured });
}
