import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import type { RedactionPolicy, Verdict } from "@tripwire/contracts";
import { OPEN_REDACTION, resolveRedaction } from "@tripwire/contracts";
import { useCallback, useId, useMemo, useRef, useState } from "react";
import {
	SegmentedControl,
	SegmentedControlItem,
} from "#/components/glaze/ui/segmented-control";
import { SkeletonSwap } from "#/components/glaze/ui/skeleton";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { DraftStoreProvider } from "#/components/responses/draft-store";
import { PreviewLinkProvider } from "#/components/responses/preview-link";
import {
	PreviewPane,
	type SheetState,
} from "#/components/responses/preview-pane";
import { RedactionSettings } from "#/components/responses/redaction-settings";
import {
	flattenConfig,
	unflattenConfig,
	VERDICTS,
} from "#/components/responses/responses-model";
import {
	PreviewSkeleton,
	SettingsSkeleton,
} from "#/components/responses/responses-page-skeleton";
import { ResponsesPreview } from "#/components/responses/responses-preview";
import { SaveState } from "#/components/responses/save-state";
import { VerdictSettings } from "#/components/responses/verdict-settings";
import {
	type SaveQueueCommit,
	SaveQueueProvider,
	useSaveQueue,
} from "#/components/save-queue";
import { useOrgPermission } from "#/hooks/use-org-permission";
import { orgRepoQueryOptions } from "#/lib/org.query";
import { pickValue } from "#/lib/pick-value";
import { RESPONSE_SCOPES, type ResponseScope } from "#/lib/repo-search";
import { saveRepoResponseConfig } from "#/lib/response.functions";
import {
	orgResponseDefaultsQueryOptions,
	responseConfigQueryOptions,
	responseQueryKeys,
} from "#/lib/response.query";

const routeApi = getRouteApi("/$org/$repo/responses");

const SCOPES: { value: ResponseScope; label: string }[] = [
	{ value: "redaction", label: "Redaction" },
	...VERDICTS,
];

const NO_MESSAGE_CHOSEN = {
	pass: false,
	block: false,
	needs_review: false,
} satisfies Record<Verdict, boolean>;

export function ResponsesPage() {
	const { org, repo: repoName } = routeApi.useParams();
	const { data: repo } = useQuery(orgRepoQueryOptions(org, repoName));
	const canEdit = useOrgPermission(org, "repoResponse:update");
	const repoId = repo?.id ?? "";
	const { data: savedConfig } = useQuery(
		responseConfigQueryOptions(org, repoId),
	);
	const { data: orgDefaults } = useQuery(orgResponseDefaultsQueryOptions(org));
	const queryClient = useQueryClient();
	const [saveError, setSaveError] = useState<string | null>(null);

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
		const next = unflattenConfig({ ...savedValues, ...pending });
		try {
			const result = await saveRepoResponseConfig({
				data: { org, repoId, config: next },
			});
			if (result && "error" in result) {
				setSaveError(result.error);
				return { error: result.error };
			}
		} catch {
			setSaveError(
				"Changes did not save. Check your connection and save again.",
			);
			return {
				error: "Changes did not save. Check your connection and save again.",
			};
		}
		setSaveError(null);
		await queryClient.invalidateQueries({
			queryKey: responseQueryKeys.config(org, repoId),
		});
		return { ok: true };
	};

	return (
		<SaveQueueProvider commit={commitBatch} savedValues={savedValues}>
			<DraftStoreProvider>
				<PreviewLinkProvider>
					<ResponsesView
						canEdit={canEdit}
						loaded={Boolean(savedConfig && orgDefaults)}
						orgPolicy={orgDefaults?.defaults.redaction ?? OPEN_REDACTION}
						onDiscarded={() => setSaveError(null)}
						saveError={saveError}
						savedValues={savedValues}
					/>
				</PreviewLinkProvider>
			</DraftStoreProvider>
		</SaveQueueProvider>
	);
}

function ResponsesView({
	canEdit,
	loaded,
	orgPolicy,
	saveError,
	savedValues,
	onDiscarded,
}: {
	canEdit: boolean;
	loaded: boolean;
	orgPolicy: RedactionPolicy;
	saveError: string | null;
	savedValues: Parameters<SaveQueueCommit>[0];
	onDiscarded: () => void;
}) {
	const { pending, setField, discard } = useSaveQueue();
	const { scope } = routeApi.useSearch();
	const navigate = routeApi.useNavigate();
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
	const verdict: Verdict = scope === "redaction" ? "block" : scope;
	const [sheet, setSheet] = useState<SheetState>("closed");
	const settingsId = useId();
	const [messageChosen, setMessageChosen] = useState(NO_MESSAGE_CHOSEN);
	const [editorEpoch, setEditorEpoch] = useState(0);
	const remembered = useRef<Partial<Record<Verdict, string>>>({});

	const config = useMemo(
		() => (loaded ? unflattenConfig({ ...savedValues, ...pending }) : null),
		[loaded, savedValues, pending],
	);
	const policy = useMemo(
		() => (config ? resolveRedaction(config.redaction, orgPolicy) : null),
		[config, orgPolicy],
	);

	const onMessageChosen = useCallback((v: Verdict, chosen: boolean) => {
		setMessageChosen((prev) =>
			prev[v] === chosen ? prev : { ...prev, [v]: chosen },
		);
	}, []);
	const rememberMessage = useCallback((v: Verdict, text: string) => {
		if (text.trim() !== "") {
			remembered.current[v] = text;
		}
	}, []);
	const recallMessage = useCallback(
		(v: Verdict) => remembered.current[v] ?? "",
		[],
	);
	const onDiscard = () => {
		discard();
		setMessageChosen(NO_MESSAGE_CHOSEN);
		setEditorEpoch((n) => n + 1);
		onDiscarded();
	};

	return (
		<DashboardLayout counts={{}}>
			<div
				className="group/responses relative flex h-full min-h-0 flex-col lg:grid lg:grid-cols-[--spacing(120)_minmax(0,1fr)] lg:grid-rows-[auto_minmax(0,1fr)] xl:grid-cols-[--spacing(150)_minmax(0,1fr)] min-[96rem]:grid-cols-[--spacing(160)_minmax(0,1fr)]"
				data-responses=""
				data-sheet={sheet}
			>
				<div className="flex min-h-0 flex-1 scroll-pt-32 scroll-pb-17 flex-col overflow-y-auto group-data-[sheet=half]/responses:scroll-pb-[50%] lg:contents">
					<header className="sticky top-0 z-(--z-sticky) flex flex-wrap items-center gap-x-10 gap-y-3 bg-paper px-4 pt-4 pb-3 md:px-6 lg:static lg:col-span-2 lg:min-h-18 lg:flex-nowrap lg:px-8 lg:py-3">
						<div className="flex min-w-0 flex-1 flex-col gap-0.5 lg:flex-none">
							<h1 className="type-title lg:type-heading">Responses</h1>
							<p className="type-body-sm text-text-2 max-lg:hidden">
								What Tripwire posts on a change request for each verdict.
							</p>
						</div>
						<div className="order-last flex w-full items-center gap-3 max-lg:overflow-x-auto lg:order-none lg:w-auto lg:flex-1">
							<SegmentedControl
								aria-label="Settings"
								className="max-lg:*:shrink-0"
								onValueChange={setScope}
								value={scope}
							>
								{SCOPES.map((option) => (
									<SegmentedControlItem key={option.value} value={option.value}>
										{option.label}
									</SegmentedControlItem>
								))}
							</SegmentedControl>
						</div>
						<SaveState
							canEdit={canEdit}
							error={saveError}
							onDiscard={onDiscard}
						/>
					</header>
					<section
						aria-labelledby={settingsId}
						className="flex flex-col lg:col-start-1 lg:row-start-2 lg:min-h-0"
					>
						<h2
							className="flex h-12 shrink-0 items-center px-6 type-label-lg text-text-1 max-lg:sr-only"
							id={settingsId}
						>
							Settings
						</h2>
						<div className="px-1 pb-6 md:px-3 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:p-5">
							<SkeletonSwap
								fallback={<SettingsSkeleton />}
								label="Loading response settings"
								loading={!config}
							>
								{config && policy && scope === "redaction" ? (
									<div className="max-w-140">
										<RedactionSettings
											canEdit={canEdit}
											config={config}
											effective={policy}
											orgPolicy={orgPolicy}
											setField={setField}
										/>
									</div>
								) : config ? (
									<div className="max-w-140">
										<VerdictSettings
											canEdit={canEdit}
											config={config}
											editorEpoch={editorEpoch}
											key={verdict}
											messageChosen={messageChosen[verdict]}
											onMessageChosen={onMessageChosen}
											recallMessage={recallMessage}
											rememberMessage={rememberMessage}
											setField={setField}
											verdict={verdict}
										/>
									</div>
								) : null}
							</SkeletonSwap>
						</div>
					</section>
					<div
						aria-hidden
						className="h-17 shrink-0 group-data-[sheet=half]/responses:h-1/2 lg:hidden"
					/>
				</div>
				<PreviewPane onSheetChange={setSheet} sheet={sheet}>
					{config && policy ? (
						<ResponsesPreview
							config={config}
							messageChosen={messageChosen[verdict]}
							policy={policy}
							showRunPage={scope === "redaction"}
							verdict={verdict}
						/>
					) : (
						<PreviewSkeleton />
					)}
				</PreviewPane>
			</div>
		</DashboardLayout>
	);
}
