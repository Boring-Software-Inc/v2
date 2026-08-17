import { FORGE_CATALOG } from "@tripwire/contracts";
import { useState } from "react";
import {
	FORGE_GRID,
	ForgeCell,
	type ForgeCellState,
} from "#/components/forges/forge-cell";
import { toast } from "#/components/ui/toast";
import { authClient } from "#/lib/auth-client";
import { LIVE_FORGES } from "#/lib/forge-copy";

/**
 * The 2×2 sign-in grid, rendered straight off `FORGE_CATALOG` — there is no
 * list of forges here. Adding one to the catalog adds a cell; flipping it to
 * `live` turns that cell into a real OAuth button, no edit to this file.
 *
 * Pending state is keyed by forge id rather than a boolean so the forges spin
 * independently. The OAuth hop is a full navigation — without it the button
 * looks inert for the whole round-trip and invites a second click.
 */
export function ForgeGrid({ redirect }: { redirect: string | undefined }) {
	const [signingIn, setSigningIn] = useState<string | null>(null);
	return (
		<div className={FORGE_GRID}>
			{FORGE_CATALOG.map((forge) => {
				const state: ForgeCellState =
					forge.status === "live"
						? {
								kind: "ready",
								pending: signingIn === forge.id,
								onSelect: async () => {
									setSigningIn(forge.id);
									const { error } = await authClient.signIn.social({
										provider: forge.id,
										callbackURL: redirect ?? "/",
									});
									if (error) {
										setSigningIn(null);
										toast.error(
											error.message ??
												`couldn't reach ${forge.label} — try again`,
										);
									}
								},
							}
						: {
								kind: "blocked",
								title: `${forge.label} isn't live yet`,
								body: `tripwire watches ${LIVE_FORGES} today.`,
							};
				return (
					<ForgeCell
						id={forge.id}
						key={forge.id}
						label={forge.label}
						state={state}
					/>
				);
			})}
		</div>
	);
}
