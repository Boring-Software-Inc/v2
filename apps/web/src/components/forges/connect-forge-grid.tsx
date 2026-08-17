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
 * GitHub connects as an App INSTALLATION: org-scoped (the install URL is minted
 * per org and only an admin may grant) and it leaves the app entirely — you pick
 * repos on github.com and webhooks sync them back.
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
	const { data: installUrl } = useQuery({
		...orgInstallUrlQueryOptions(org ?? ""),
		enabled: Boolean(org) && isOrgAdmin,
	});

	function githubState(): ForgeCellState {
		if (!org) {
			return {
				kind: "blocked",
				title: "open an org first",
				body: "github grants repos to an org — pick one, then connect.",
			};
		}
		if (!isOrgAdmin) {
			return {
				kind: "blocked",
				title: "admins only",
				body: "ask an org admin to connect github repos.",
			};
		}
		if (installUrl?.status !== "ready") {
			return {
				kind: "blocked",
				title: "github app unavailable",
				body:
					installUrl?.status === "not-configured"
						? "the github app isn't configured on this deployment."
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
		github: githubState,
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
