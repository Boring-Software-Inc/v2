import { useState } from "react";
import { FORGE_GRID, ForgeCell } from "#/components/forges/forge-cell";
import { toast } from "#/components/glaze/ui/toast";
import { authClient } from "#/lib/auth-client";
import { signInForges } from "#/lib/forge-grid";

/**
 * The sign-in grid, rendered straight off `FORGE_CATALOG`: there is no list of
 * forges here. Giving a catalog entry a `signIn` enables its button, no edit to
 * this file.
 *
 * A cell is enabled when the forge can be SIGNED INTO, which is not the same as
 * `status: "live"`. A forge's OAuth can ship long before its adapter. Keying
 * this grid on `status` would disable a working login.
 *
 * Pending state is keyed by forge id rather than a boolean so the forges spin
 * independently. The OAuth hop is a full navigation; without it the button
 * looks inert for the whole round-trip and invites a second click.
 */
export function ForgeGrid({ redirect }: { redirect: string | undefined }) {
	const [signingIn, setSigningIn] = useState<string | null>(null);

	return (
		<div className={FORGE_GRID}>
			{signInForges().map((forge) => (
				<ForgeCell
					id={forge.id}
					key={forge.id}
					label={forge.label}
					state={
						forge.available
							? {
									kind: "ready",
									pending: signingIn === forge.id,
									onSelect: async () => {
										setSigningIn(forge.id);
										const callbackURL = redirect ?? "/";
										const { error } = await authClient.signIn.social({
											provider: forge.id,
											callbackURL,
										});
										if (error) {
											setSigningIn(null);
											toast.fail(
												error.message ??
													`Couldn't reach ${forge.label}. Check your connection and try again.`,
											);
										}
									},
								}
							: { kind: "unavailable" }
					}
				/>
			))}
		</div>
	);
}
