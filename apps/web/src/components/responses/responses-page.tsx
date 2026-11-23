import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import type { ForgeId, RedactionPolicy } from "@tripwire/contracts";
import { OPEN_REDACTION, resolveRedaction } from "@tripwire/contracts";
import { SkeletonSwap } from "@tripwire/ui/skeleton";
import { useMemo, useState } from "react";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { ResponseBuilder } from "#/components/responses/blocks/response-builder";
import { PreviewLinkProvider } from "#/components/responses/preview-link";
import { ResponsesMobileBlocker } from "#/components/responses/responses-mobile-blocker";
import {
	flattenConfig,
	outcomeMeta,
	unflattenConfig,
} from "#/components/responses/responses-model";
import { BuilderSkeleton } from "#/components/responses/responses-page-skeleton";
import { useSaveResponseConfig } from "#/components/responses/use-save-response-config";
import {
	type SaveQueueCommit,
	SaveQueueProvider,
	UnsavedChangesToolbar,
	useSaveQueue,
} from "#/components/save-queue";
import { useOrgPermission } from "#/hooks/use-org-permission";
import { orgRepoQueryOptions } from "#/lib/org.query";
import { pickValue } from "#/lib/pick-value";
import { RESPONSE_SCOPES } from "#/lib/repo-search";
import {
	orgResponseDefaultsQueryOptions,
	responseConfigQueryOptions,
} from "#/lib/response.query";

const routeApi = getRouteApi("/$org/$repo/responses");

export function ResponsesPage() {
	const { org, repo: repoName } = routeApi.useParams();
	const { data: repo } = useQuery(orgRepoQueryOptions(org, repoName));
	const canEdit = useOrgPermission(org, "responses:manage");
	const repoId = repo?.id ?? "";
	const { data: savedConfig } = useQuery(
		responseConfigQueryOptions(org, repoId),
	);
	const { data: orgDefaults } = useQuery(orgResponseDefaultsQueryOptions(org));
	const saveConfig = useSaveResponseConfig(org, repoId);

	const savedValues = useMemo(
		() => (savedConfig ? flattenConfig(savedConfig) : {}),
		[savedConfig],
	);

	const commitBatch: SaveQueueCommit = async (pending) => {
		if (!savedConfig) {
			return {
				error: "Settings are still loading. Wait a moment and save again.",
			};
		}
		return saveConfig
			.mutateAsync(unflattenConfig({ ...savedValues, ...pending }))
			.then(() => ({ ok: true as const }))
			.catch((error: Error) => ({ error: error.message }));
	};

	return (
		<SaveQueueProvider commit={commitBatch} savedValues={savedValues}>
			<PreviewLinkProvider>
				<ResponsesView
					canEdit={canEdit}
					forge={repo?.forge ?? null}
					loaded={Boolean(savedConfig && orgDefaults)}
					onDiscarded={saveConfig.reset}
					org={org}
					repo={repoName}
					orgPolicy={orgDefaults?.defaults.redaction ?? OPEN_REDACTION}
					saveError={saveConfig.error?.message ?? null}
					savedValues={savedValues}
				/>
			</PreviewLinkProvider>
		</SaveQueueProvider>
	);
}

interface ResponsesViewProps {
	forge: ForgeId | null;
	canEdit: boolean;
	org: string;
	repo: string;
	loaded: boolean;
	orgPolicy: RedactionPolicy;
	saveError: string | null;
	savedValues: Parameters<SaveQueueCommit>[0];
	onDiscarded: () => void;
}

function ResponsesView({
	canEdit,
	forge,
	org,
	repo,
	loaded,
	orgPolicy,
	saveError,
	savedValues,
	onDiscarded,
}: ResponsesViewProps) {
	const { pending, setField, discard } = useSaveQueue();
	const { scope } = routeApi.useSearch();
	const navigate = routeApi.useNavigate();
	const outcome = outcomeMeta(scope);
	const [epoch, setEpoch] = useState(0);

	const config = useMemo(
		() => (loaded ? unflattenConfig({ ...savedValues, ...pending }) : null),
		[loaded, savedValues, pending],
	);
	const policy = config ? resolveRedaction(config.redaction, orgPolicy) : null;

	const setScope = (value: string) => {
		const next = pickValue(RESPONSE_SCOPES, value);
		if (next) {
			void navigate({
				search: (prev) => ({ ...prev, scope: next }),
				replace: true,
				resetScroll: false,
			});
		}
	};
	const onDiscard = () => {
		discard();
		setEpoch((n) => n + 1);
		onDiscarded();
	};

	return (
		<DashboardLayout counts={{}}>
			<div data-layout-role="responses-shell">
				<div className="min-h-0 flex-1">
					<SkeletonSwap
						fallback={<BuilderSkeleton forge={forge} />}
						label="Loading response settings"
						loading={!(config && policy)}
					>
						{config && policy ? (
							<div
								className="max-lg:hidden"
								data-layout-role="response-workspace"
							>
								<ResponseBuilder
									canEdit={canEdit}
									config={config}
									forge={forge}
									key={`${outcome.value}-${epoch}`}
									onOutcomeChange={setScope}
									org={org}
									orgPolicy={orgPolicy}
									outcome={outcome}
									policy={policy}
									saveToolbar={
										canEdit ? (
											<UnsavedChangesToolbar
												error={saveError}
												onDiscard={onDiscard}
											/>
										) : null
									}
									setField={setField}
								/>
							</div>
						) : null}
					</SkeletonSwap>
				</div>
				<ResponsesMobileBlocker org={org} repo={repo} />
			</div>
		</DashboardLayout>
	);
}
