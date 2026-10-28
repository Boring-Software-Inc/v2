import { useQuery } from "@tanstack/react-query";
import { availableForges } from "@tripwire/utils/forge-sign-in";
import { useState } from "react";
import {
	FORGE_GRID,
	ForgeCell,
	type ForgeCellState,
} from "#/components/forges/forge-cell";
import { toast } from "#/components/glaze/ui/toast";
import { providerAvailabilityQueryOptions } from "#/lib/auth.query";
import { authClient } from "#/lib/auth-client";

/**
 * Catalog support and initialized server registration are both required.
 * Sign-in can ship independently of ingest and connect.
 *
 * Pending state is keyed by forge id rather than a boolean so the forges spin
 * independently. The OAuth hop is a full navigation; without it the button
 * looks inert for the whole round-trip and invites a second click.
 */
export function ForgeGrid({ redirect }: { redirect: string | undefined }) {
	const [signingIn, setSigningIn] = useState<string | null>(null);
	const providers = useQuery(providerAvailabilityQueryOptions());

	async function signIn(forge: ReturnType<typeof availableForges>[number]) {
		setSigningIn(forge.id);
		const fallback = `Couldn't reach ${forge.label}. Check your connection and try again.`;
		try {
			const { error } = await authClient.signIn.social({
				provider: forge.id,
				callbackURL: redirect ?? "/",
			});
			if (!error) {
				return;
			}
			toast.fail(error.message ?? fallback);
		} catch {
			toast.fail(fallback);
		}
		setSigningIn(null);
	}

	function cellState(
		forge: ReturnType<typeof availableForges>[number],
	): ForgeCellState {
		if (providers.isPending) {
			return { kind: "loading" };
		}
		if (providers.isError) {
			return {
				kind: "blocked",
				title: "Sign-in is unavailable right now",
				body: "Tripwire couldn't load its sign-in providers. Refresh the page to try again.",
			};
		}
		if (!forge.available) {
			return { kind: "unavailable" };
		}
		return {
			kind: "ready",
			pending: signingIn === forge.id,
			onSelect: () => void signIn(forge),
		};
	}

	return (
		<div className={FORGE_GRID}>
			{availableForges(providers.data).map((forge) => (
				<ForgeCell
					id={forge.id}
					key={forge.id}
					label={forge.label}
					state={cellState(forge)}
				/>
			))}
		</div>
	);
}
