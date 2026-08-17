import { FORGE_CATALOG, forgeSignIn } from "@tripwire/contracts";
import { useState } from "react";
import {
	FORGE_GRID,
	ForgeCell,
	type ForgeCellState,
} from "#/components/forges/forge-cell";
import { toast } from "#/components/ui/toast";
import { authClient } from "#/lib/auth-client";
import { SIGN_IN_FORGES } from "#/lib/forge-copy";

/**
 * The 2×2 sign-in grid, rendered straight off `FORGE_CATALOG` — there is no
 * list of forges here. Adding one to the catalog adds a cell; giving it a
 * `signIn` turns that cell into a real OAuth button, no edit to this file.
 *
 * A cell is live when the forge can be SIGNED INTO, which is not the same as
 * `status: "live"`. A forge's OAuth can ship long before its adapter: open-git
 * is exactly that today — you can authenticate with it, but it owns no repos.
 * Keying this grid on `status` would hide a working login.
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
				const kind = forgeSignIn(forge.id);
				const state: ForgeCellState = kind
					? {
							kind: "ready",
							pending: signingIn === forge.id,
							onSelect: async () => {
								setSigningIn(forge.id);
								const callbackURL = redirect ?? "/";
								// `social` is a first-class better-auth provider; `oauth2` is
								// the genericOAuth plugin. Same button, different endpoint —
								// the catalog says which, so neither is hardcoded here.
								const { error } =
									kind === "social"
										? await authClient.signIn.social({
												provider: forge.id,
												callbackURL,
											})
										: await authClient.signIn.oauth2({
												providerId: forge.id,
												callbackURL,
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
							body: `you can sign in with ${SIGN_IN_FORGES} today.`,
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
