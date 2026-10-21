import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import type { Verdict } from "@tripwire/contracts";
import { useCallback, useMemo, useRef, useState } from "react";
import {
	flattenConfig,
	unflattenConfig,
	VERDICTS,
} from "#/components/customize/customize-model";
import { CustomizeBodySkeleton } from "#/components/customize/customize-page-skeleton";
import { CustomizePreview } from "#/components/customize/customize-preview";
import { DraftStoreProvider } from "#/components/customize/draft-store";
import { PreviewLinkProvider } from "#/components/customize/preview-link";
import { MobileSaveBar, SaveState } from "#/components/customize/save-state";
import { VerdictSettings } from "#/components/customize/verdict-settings";
import { SkeletonSwap } from "#/components/glaze/ui/skeleton";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "#/components/glaze/ui/tabs";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import {
	type SaveQueueCommit,
	SaveQueueProvider,
	useSaveQueue,
} from "#/components/save-queue";
import { orgContextQueryOptions, orgRepoQueryOptions } from "#/lib/org.query";
import { saveRepoResponseConfig } from "#/lib/response.functions";
import {
	responseConfigQueryOptions,
	responseQueryKeys,
} from "#/lib/response.query";

const routeApi = getRouteApi("/$org/$repo/customize");

const NO_MESSAGE_CHOSEN: Record<Verdict, boolean> = {
	pass: false,
	block: false,
	needs_review: false,
};

export function CustomizePage() {
	const { org, repo: repoName } = routeApi.useParams();
	const { data: repo } = useQuery(orgRepoQueryOptions(org, repoName));
	const { data: orgContext } = useQuery(orgContextQueryOptions(org));
	const isAdmin = orgContext?.role === "admin";
	const repoId = repo?.id ?? "";
	const { data: savedConfig } = useQuery(
		responseConfigQueryOptions(org, repoId),
	);
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
					<CustomizeView
						canEdit={isAdmin}
						loaded={Boolean(savedConfig)}
						onDiscarded={() => setSaveError(null)}
						saveError={saveError}
						savedValues={savedValues}
					/>
				</PreviewLinkProvider>
			</DraftStoreProvider>
		</SaveQueueProvider>
	);
}

function CustomizeView({
	canEdit,
	loaded,
	saveError,
	savedValues,
	onDiscarded,
}: {
	canEdit: boolean;
	loaded: boolean;
	saveError: string | null;
	savedValues: Record<string, unknown>;
	onDiscarded: () => void;
}) {
	const { pending, setField, discard } = useSaveQueue();
	const [verdict, setVerdict] = useState<Verdict>("block");
	const [messageChosen, setMessageChosen] = useState(NO_MESSAGE_CHOSEN);
	const [editorEpoch, setEditorEpoch] = useState(0);
	const remembered = useRef<Partial<Record<Verdict, string>>>({});

	const config = useMemo(
		() => (loaded ? unflattenConfig({ ...savedValues, ...pending }) : null),
		[loaded, savedValues, pending],
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
			<div className="px-4 py-6 md:px-8 md:py-8">
				<div className="mx-auto flex w-full max-w-312 flex-col gap-6">
					<header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
						<div className="flex min-w-0 flex-col gap-1">
							<h1 className="type-title">Customize</h1>
							<p className="type-body text-text-2">
								What Tripwire posts on a change request for each verdict.
							</p>
						</div>
						<SaveState
							canEdit={canEdit}
							error={saveError}
							onDiscard={onDiscard}
						/>
					</header>

					<SkeletonSwap
						fallback={<CustomizeBodySkeleton />}
						label="Loading response settings"
						loading={!config}
					>
						{config ? (
							<Tabs
								className="flex flex-col gap-6"
								onValueChange={(value) => setVerdict(value as Verdict)}
								value={verdict}
							>
								<TabsList activateOnFocus aria-label="Verdict">
									{VERDICTS.map((v) => (
										<TabsTrigger key={v.value} value={v.value}>
											{v.label}
										</TabsTrigger>
									))}
								</TabsList>
								{VERDICTS.map((v) => (
									<TabsContent key={v.value} value={v.value}>
										<div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
											<div className="lg:w-md lg:shrink-0">
												<VerdictSettings
													canEdit={canEdit}
													config={config}
													editorEpoch={editorEpoch}
													messageChosen={messageChosen[v.value]}
													onMessageChosen={onMessageChosen}
													recallMessage={recallMessage}
													rememberMessage={rememberMessage}
													setField={setField}
													verdict={v.value}
												/>
											</div>
											<div className="min-w-0 lg:sticky lg:top-6 lg:flex-1">
												<CustomizePreview
													config={config}
													messageChosen={messageChosen[v.value]}
													verdict={v.value}
												/>
											</div>
										</div>
									</TabsContent>
								))}
							</Tabs>
						) : null}
					</SkeletonSwap>
					<MobileSaveBar
						canEdit={canEdit}
						error={saveError}
						onDiscard={onDiscard}
					/>
				</div>
			</div>
		</DashboardLayout>
	);
}
