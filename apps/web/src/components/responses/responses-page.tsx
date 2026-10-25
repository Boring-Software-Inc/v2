import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import type { RedactionPolicy } from "@tripwire/contracts";
import { OPEN_REDACTION, resolveRedaction } from "@tripwire/contracts";
import { useMemo, useState } from "react";
import {
	SegmentedControl,
	SegmentedControlItem,
} from "#/components/glaze/ui/segmented-control";
import { SkeletonSwap } from "#/components/glaze/ui/skeleton";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { ResponseBuilder } from "#/components/responses/blocks/response-builder";
import { PreviewLinkProvider } from "#/components/responses/preview-link";
import { RedactionSettings } from "#/components/responses/redaction-settings";
import {
	flattenConfig,
	OUTCOMES,
	outcomeMeta,
	unflattenConfig,
} from "#/components/responses/responses-model";
import { BuilderSkeleton } from "#/components/responses/responses-page-skeleton";
import { SaveState } from "#/components/responses/save-state";
import { useSaveResponseConfig } from "#/components/responses/use-save-response-config";
import {
	type SaveQueueCommit,
	SaveQueueProvider,
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
					loaded={Boolean(savedConfig && orgDefaults)}
					onDiscarded={saveConfig.reset}
					org={org}
					orgPolicy={orgDefaults?.defaults.redaction ?? OPEN_REDACTION}
					saveError={saveConfig.error?.message ?? null}
					savedValues={savedValues}
				/>
			</PreviewLinkProvider>
		</SaveQueueProvider>
	);
}

interface ResponsesViewProps {
	canEdit: boolean;
	org: string;
	loaded: boolean;
	orgPolicy: RedactionPolicy;
	saveError: string | null;
	savedValues: Parameters<SaveQueueCommit>[0];
	onDiscarded: () => void;
}

function ResponsesView({
	canEdit,
	org,
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
			<div className="flex h-full min-h-0 flex-col overflow-y-auto">
				<header className="flex flex-wrap items-center gap-x-10 gap-y-3 px-4 pt-4 pb-3 md:px-6 lg:min-h-18 lg:px-8 lg:py-3">
					<h1 className="me-auto type-title lg:type-heading">Responses</h1>
					<SaveState
						canEdit={canEdit}
						error={saveError}
						onDiscard={onDiscard}
					/>
				</header>
				<div className="px-4 pb-4 md:px-6 lg:px-8">
					<SegmentedControl
						aria-label="Outcome"
						className="max-w-full overflow-x-auto"
						onValueChange={setScope}
						value={scope}
					>
						{OUTCOMES.map((option) => (
							<SegmentedControlItem key={option.value} value={option.value}>
								{option.label}
							</SegmentedControlItem>
						))}
					</SegmentedControl>
				</div>
				<SkeletonSwap
					fallback={<BuilderSkeleton />}
					label="Loading response settings"
					loading={!(config && policy)}
				>
					{config && policy ? (
						<div className="grid min-h-0 flex-1 grid-cols-1 gap-4 px-4 pb-6 md:px-6 lg:grid-cols-[auto_minmax(0,1fr)] lg:px-8 xl:grid-cols-[auto_minmax(0,1fr)_--spacing(96)]">
							<ResponseBuilder
								canEdit={canEdit}
								config={config}
								key={`${outcome.value}-${epoch}`}
								org={org}
								outcome={outcome}
								policy={policy}
								setField={setField}
							/>
							<div className="lg:col-span-2 xl:col-span-1">
								<RedactionSettings
									canEdit={canEdit}
									config={config}
									effective={policy}
									orgPolicy={orgPolicy}
									setField={setField}
								/>
							</div>
						</div>
					) : null}
				</SkeletonSwap>
			</div>
		</DashboardLayout>
	);
}
