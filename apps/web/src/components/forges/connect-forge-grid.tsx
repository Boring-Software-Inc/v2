import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { FORGE_CATALOG } from "@tripwire/contracts";
import { useEffect } from "react";
import {
	FORGE_GRID,
	ForgeCell,
	type ForgeCellState,
} from "#/components/forges/forge-cell";
import { toast } from "#/components/ui/toast";
import { connectionsQueryOptions } from "#/lib/connections.query";
import {
	ForgeReauthRequiredError,
	reconnectForge,
	takePendingConnect,
} from "#/lib/forge-connect";
import { LIVE_FORGES } from "#/lib/forge-copy";
import { importGitlabRepos } from "#/lib/gitlab-connect";
import { orgInstallUrlQueryOptions } from "#/lib/onboarding.query";
import { myOrgsQueryOptions } from "#/lib/org.query";

/**
 * "connect repos" — the same 2×2 catalog grid as sign-in, with connect as the
 * verb. The two forges connect in structurally different ways and the grid does
 * not pretend otherwise:
 *
 * - GitHub is an App INSTALLATION. It is org-scoped (the install URL is minted
 *   per org and only an admin may grant), and it leaves the app entirely — you
 *   pick repos on github.com and webhooks sync them back.
 * - GitLab is an API IMPORT. It is user-scoped, never leaves the app, and lands
 *   the projects as unclaimed rows for the shared claim screen to bind to an org.
 *
 * Where GitHub can't run, the cell is blocked WITH THE REASON rather than
 * hidden — a missing menu item teaches nothing, and "add repos" silently
 * vanishing for non-admins is the bug this replaces.
 */
export function ConnectForgeGrid({
	org,
	onDone,
}: {
	/** The org slug in URL context, or null outside an org route. */
	org: string | null;
	onDone?: () => void;
}) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { data: orgs } = useQuery(myOrgsQueryOptions());
	const isOrgAdmin =
		(orgs ?? []).find((entry) => entry.slug === org)?.role === "admin";
	const { data: connections } = useQuery(connectionsQueryOptions());
	const gitlabLinked = (connections ?? []).some(
		(entry) => entry.forge === "gitlab",
	);
	const { data: installUrl } = useQuery({
		...orgInstallUrlQueryOptions(org ?? ""),
		enabled: Boolean(org) && isOrgAdmin,
	});

	const connectGitlab = useMutation({
		mutationFn: importGitlabRepos,
		onSuccess: (result) => {
			onDone?.();
			// Only the claim screen when there is something to claim. Re-importing
			// an account whose projects already belong to an org used to land here
			// on an empty picker worded entirely about github installations.
			if (result.unclaimed === 0) {
				toast.success(
					result.imported === 0
						? "no gitlab projects found — you need maintainer access"
						: "gitlab projects are already connected to an org",
				);
				void queryClient.invalidateQueries();
				return;
			}
			const noun = result.unclaimed === 1 ? "project" : "projects";
			toast.success(
				`${result.unclaimed} gitlab ${noun} to claim — pick an org`,
			);
			navigate({
				to: "/onboarding/setup",
				search: {
					installation_id: undefined,
					setup_action: undefined,
					state: undefined,
				},
			});
		},
		onError: (error) => {
			// A dead token is recoverable, so it gets a button rather than a red
			// dead end. Signing out and back in does NOT fix this — the session is
			// fine, only the gitlab grant is stale — so the action is the only exit.
			if (error instanceof ForgeReauthRequiredError) {
				toast({
					title: "gitlab session expired",
					body: "reconnect gitlab to import your projects.",
					status: "warning",
					dedupeKey: "forge-reauth:gitlab",
					action: {
						label: "reconnect",
						onClick: () => {
							void reconnectForge("gitlab").then((message) => {
								if (message) {
									toast.error(message);
								}
							});
						},
					},
				});
				return;
			}
			toast.error(
				error instanceof Error ? error.message : "gitlab import failed",
			);
		},
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

	function gitlabState(): ForgeCellState {
		return {
			kind: "ready",
			pending: connectGitlab.isPending,
			// An unlinked forge LINKS; a linked one imports. Same button either way —
			// the account link is plumbing, not a step the user should have to know
			// about, and firing the import first only earns a "connect gitlab first"
			// dead end with nowhere to go from it.
			onSelect: () => {
				if (!gitlabLinked) {
					void reconnectForge("gitlab").then((message) => {
						if (message) {
							toast.error(message);
						}
					});
					return;
				}
				connectGitlab.mutate();
			},
		};
	}

	// Back from the OAuth hop: finish what the click started. The linked check
	// comes BEFORE consuming the flag — reading it early would clear the intent
	// on a mount that can't act on it yet, and the import would never fire.
	useEffect(() => {
		if (!gitlabLinked) {
			return;
		}
		if (takePendingConnect() === "gitlab") {
			connectGitlab.mutate();
		}
	}, [gitlabLinked, connectGitlab.mutate]);

	const STATE: Record<string, () => ForgeCellState> = {
		github: githubState,
		gitlab: gitlabState,
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
