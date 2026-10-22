import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { FORGE_CATALOG, forgeConnectable } from "@tripwire/contracts";
import {
	FORGE_GRID,
	ForgeCell,
	type ForgeCellState,
} from "#/components/forges/forge-cell";
import { LIVE_FORGES } from "#/lib/forge-copy";
import type { InstallUrlState } from "#/lib/onboarding.functions";
import { orgInstallUrlQueryOptions } from "#/lib/onboarding.query";
import { myOrgsQueryOptions } from "#/lib/org.query";
import { trackEvent } from "#/lib/track";

/**
 * "connect repos" — the same 2×2 catalog grid as sign-in, with connect as the
 * verb. One cell per catalog entry: a `live` forge gets a real connect action, a
 * `planned` one is inert and says so.
 *
 * Both live forges connect as an app/bot INSTALLATION: org-scoped (the install
 * url is minted per org and only an admin may grant) and the flow leaves the app
 * entirely — you pick repos on the forge, and it sends you back.
 *
 * GitHub round-trips a signed state, so its callback can name both sides and ask
 * you to confirm. open-git returns `installation_id` alone, so the same callback
 * falls through to the CLAIM screen and asks which org it belongs to. Both end
 * up bound deliberately; neither auto-attaches on a guess (§10).
 *
 * Where a live forge can't run, the cell is blocked WITH THE REASON rather than
 * hidden — a missing menu item teaches nothing, and "add repos" silently
 * vanishing for non-admins is the bug this replaces.
 *
 * Every live forge needs an entry in `STATE`. One flipped to `live` in the
 * catalog without one falls through to an honest "can't connect yet" instead of
 * a cell that looks ready and does nothing.
 */
export function ConnectForgeGrid({
	org,
	onDone,
}: {
	/** The org slug in URL context, or null outside an org route. */
	org: string | null;
	onDone?: () => void;
}) {
	const { data: orgs, isPending: orgsPending } = useQuery(myOrgsQueryOptions());
	const isOrgAdmin =
		(orgs ?? []).find((entry) => entry.slug === org)?.role === "admin";
	const github = useQuery({
		...orgInstallUrlQueryOptions(org ?? "", "github"),
		enabled: Boolean(org) && isOrgAdmin,
	});
	const openGit = useQuery({
		...orgInstallUrlQueryOptions(org ?? "", "opengit"),
		enabled: Boolean(org) && isOrgAdmin,
	});

	/**
	 * Both live forges install the same way — an app/bot INSTALLATION, granted
	 * per org, completed on the forge's own site — so they share one cell
	 * builder rather than two near-copies that drift. What differs is only the
	 * url and the copy, and both come in as arguments.
	 *
	 * (GitLab, when it lands, does NOT fit here: it is an api import, user-scoped
	 * and never leaving the app. It needs its own builder, not another argument.)
	 */
	function installState(
		label: string,
		install: UseQueryResult<InstallUrlState>,
	): ForgeCellState {
		if (!org) {
			return {
				kind: "blocked",
				title: "Open an org first",
				body: `${label} connects repos to an org. Open the org you want, then connect.`,
			};
		}
		if (orgsPending) {
			return { kind: "loading" };
		}
		if (!isOrgAdmin) {
			return {
				kind: "blocked",
				title: "Only org admins can connect repos",
				body: `Ask an admin of this org to connect ${label} repos.`,
			};
		}
		if (install.isPending) {
			return { kind: "loading" };
		}
		const installUrl = install.data;
		if (installUrl?.status !== "ready") {
			return {
				kind: "blocked",
				title: `${label} can't connect right now`,
				body:
					installUrl?.status === "not-configured"
						? `The ${label} app isn't set up on this Tripwire server. Ask whoever runs it to add the app.`
						: `Tripwire couldn't create the ${label} install link. Try again in a minute.`,
			};
		}
		return {
			kind: "ready",
			onSelect: () => {
				onDone?.();
				trackEvent("github_app_install_started", {
					forge: label.toLowerCase(),
				});
				window.location.assign(installUrl.url);
			},
		};
	}

	/**
	 * A Map, not a dictionary: a catalog entry with no builder here must MISS,
	 * which is what makes the cell fall through to an honest "can't connect yet"
	 * instead of an open index signature quietly returning undefined.
	 */
	const STATE = new Map<string, () => ForgeCellState>([
		["github", () => installState("GitHub", github)],
		["opengit", () => installState("OpenGit", openGit)],
	]);

	return (
		<div className={FORGE_GRID}>
			{FORGE_CATALOG.map((forge) => (
				<ForgeCell
					id={forge.id}
					key={forge.id}
					label={forge.label}
					showReason
					state={
						forgeConnectable(forge.id)
							? (STATE.get(forge.id)?.() ?? {
									kind: "blocked",
									title: `${forge.label} can't connect yet`,
									body: `You can sign in with ${forge.label}, but Tripwire can't watch its repos yet.`,
								})
							: {
									kind: "blocked",
									title: `${forge.label} isn't available yet`,
									body: `Tripwire watches ${LIVE_FORGES} today.`,
								}
					}
				/>
			))}
		</div>
	);
}
