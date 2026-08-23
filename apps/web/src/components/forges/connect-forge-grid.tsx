import { useQuery } from "@tanstack/react-query";
import { FORGE_CATALOG } from "@tripwire/contracts";
import {
	FORGE_GRID,
	ForgeCell,
	type ForgeCellState,
} from "#/components/forges/forge-cell";
import { LIVE_FORGES } from "#/lib/forge-copy";
import { orgInstallUrlQueryOptions } from "#/lib/onboarding.query";
import { myOrgsQueryOptions } from "#/lib/org.query";

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
	const { data: orgs } = useQuery(myOrgsQueryOptions());
	const isOrgAdmin =
		(orgs ?? []).find((entry) => entry.slug === org)?.role === "admin";
	const { data: githubUrl } = useQuery({
		...orgInstallUrlQueryOptions(org ?? "", "github"),
		enabled: Boolean(org) && isOrgAdmin,
	});
	const { data: openGitUrl } = useQuery({
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
		installUrl: typeof githubUrl,
	): ForgeCellState {
		if (!org) {
			return {
				kind: "blocked",
				title: "open an org first",
				body: `${label} grants repos to an org — pick one, then connect.`,
			};
		}
		if (!isOrgAdmin) {
			return {
				kind: "blocked",
				title: "admins only",
				body: `ask an org admin to connect ${label} repos.`,
			};
		}
		if (installUrl?.status !== "ready") {
			return {
				kind: "blocked",
				title: `${label} app unavailable`,
				body:
					installUrl?.status === "not-configured"
						? `the ${label} app isn't configured on this deployment.`
						: "couldn't mint an install url — try again shortly.",
			};
		}
		return {
			kind: "ready",
			onSelect: () => {
				onDone?.();
				window.location.assign(installUrl.url);
			},
		};
	}

	const STATE: Record<string, () => ForgeCellState> = {
		github: () => installState("github", githubUrl),
		opengit: () => installState("open-git", openGitUrl),
	};

	return (
		<div className={FORGE_GRID}>
			{FORGE_CATALOG.map((forge) => (
				<ForgeCell
					id={forge.id}
					key={forge.id}
					label={forge.label}
					state={
						forge.status === "live"
							? (STATE[forge.id]?.() ?? {
									kind: "blocked",
									title: `${forge.label} can't connect yet`,
									body: "this forge signs in but has no repo import.",
								})
							: {
									kind: "blocked",
									title: `${forge.label} isn't live yet`,
									body: `tripwire watches ${LIVE_FORGES} today.`,
								}
					}
				/>
			))}
		</div>
	);
}
