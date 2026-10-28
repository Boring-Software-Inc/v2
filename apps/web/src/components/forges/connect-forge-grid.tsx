import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import type { ForgeId } from "@tripwire/contracts";
import { availableForges } from "@tripwire/utils/forge-sign-in";
import { ForgeMark } from "#/components/common/forge-marks";
import {
	FORGE_GRID,
	ForgeCell,
	type ForgeCellState,
} from "#/components/forges/forge-cell";
import { GitCafeRepositorySelection } from "#/components/forges/gitcafe-repository-selection";
import { providerAvailabilityQueryOptions } from "#/lib/auth.query";
import { organizationConnectionsQueryOptions } from "#/lib/connections.query";
import type { InstallUrlState } from "#/lib/onboarding.functions";
import { orgInstallUrlQueryOptions } from "#/lib/onboarding.query";
import { orgContextQueryOptions } from "#/lib/org.query";
import { trackEvent } from "#/lib/track";

/** Install links use the same provider decision as login, then enforce org access. */
export function ConnectForgeGrid({
	org,
	onDone,
}: {
	org: string | null;
	onDone?: () => void;
}) {
	const providers = useQuery(providerAvailabilityQueryOptions());
	const orgAccess = useQuery({
		...orgContextQueryOptions(org ?? ""),
		enabled: Boolean(org),
	});
	const canManage =
		orgAccess.data?.permissions.includes("connections:manage") ?? false;
	return (
		<div className={FORGE_GRID}>
			{availableForges(providers.data).map((forge) => (
				<ConnectForgeCell
					key={forge.id}
					forge={forge}
					org={org}
					onDone={onDone}
					canManage={canManage}
					providersPending={providers.isPending}
					providersError={providers.isError}
					orgPending={orgAccess.isPending}
					orgError={orgAccess.isError}
				/>
			))}
		</div>
	);
}

function ConnectForgeCell({
	forge,
	org,
	onDone,
	canManage,
	providersPending,
	providersError,
	orgPending,
	orgError,
}: {
	forge: ReturnType<typeof availableForges>[number];
	org: string | null;
	onDone?: () => void;
	canManage: boolean;
	providersPending: boolean;
	providersError: boolean;
	orgPending: boolean;
	orgError: boolean;
}) {
	const install = useQuery({
		...orgInstallUrlQueryOptions(org ?? "", forge.id),
		enabled: Boolean(org) && canManage && forge.available && !providersError,
	});
	const connections = useQuery({
		...organizationConnectionsQueryOptions(org ?? ""),
		enabled:
			forge.id === "gitcafe" &&
			Boolean(org) &&
			canManage &&
			forge.available &&
			!providersError,
	});
	const existing = connections.data?.find(
		(connection) => connection.forge === "gitcafe",
	);
	function cellState(): ForgeCellState {
		if (providersPending) return { kind: "loading" };
		if (providersError)
			return {
				kind: "blocked",
				title: "Providers are unavailable right now",
				body: "Tripwire couldn't load its providers. Refresh the page to try again.",
			};
		if (!forge.available) return { kind: "unavailable" };
		if (!org)
			return {
				kind: "blocked",
				title: "Open an org first",
				body: `${forge.label} connects repos to an org. Open the org you want, then connect.`,
			};
		if (orgPending) return { kind: "loading" };
		if (orgError)
			return {
				kind: "blocked",
				title: "Couldn't load your org access",
				body: "Refresh the page to try again.",
			};
		if (!canManage)
			return {
				kind: "blocked",
				title: "You can't manage connections in this org",
				body: `Ask an org admin to connect ${forge.label} repos.`,
			};
		if (forge.id === "gitcafe" && connections.isPending)
			return { kind: "loading" };
		if (forge.id === "gitcafe" && connections.isError)
			return {
				kind: "blocked",
				title: "Couldn't load GitCafe connections",
				body: "Refresh the page to check your existing installations before connecting.",
			};
		return installCellState(forge.id, forge.label, install, onDone);
	}
	const state = cellState();
	if (
		forge.id === "gitcafe" &&
		state.kind === "ready" &&
		org &&
		existing?.installations.length
	)
		return (
			<div className="col-span-2 flex min-w-0 flex-col gap-3">
				<div className="inline-flex items-center gap-2 type-label">
					<ForgeMark forge="gitcafe" />
					GitCafe
				</div>
				<GitCafeRepositorySelection
					installations={existing.installations}
					org={org}
				/>
				<ForgeCell
					id="gitcafe"
					label="Install on another GitCafe org"
					state={state}
				/>
			</div>
		);
	return <ForgeCell id={forge.id} label={forge.label} state={state} />;
}

function installCellState(
	id: ForgeId,
	label: string,
	install: UseQueryResult<InstallUrlState>,
	onDone: (() => void) | undefined,
): ForgeCellState {
	if (install.isPending) return { kind: "loading" };
	const installUrl = install.data;
	if (install.isError || installUrl?.status !== "ready")
		return {
			kind: "blocked",
			title: `${label} can't connect right now`,
			body:
				installUrl?.status === "not-configured"
					? `The ${label} app isn't set up on this Tripwire server. Ask whoever runs it to add the app.`
					: `Tripwire couldn't create the ${label} install link. Try again in a minute.`,
		};
	return {
		kind: "ready",
		onSelect: () => {
			onDone?.();
			trackEvent("github_app_install_started", { forge: id });
			window.location.assign(installUrl.url);
		},
	};
}
