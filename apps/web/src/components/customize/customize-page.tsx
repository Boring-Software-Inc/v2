import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import type {
	CommentReason,
	ResponseConfig,
	Verdict,
} from "@tripwire/contracts";
import {
	BADGE_PATH,
	renderVerdictComment,
	wantsCheck,
	wantsComment,
} from "@tripwire/contracts";
import { useState } from "react";
import { toast } from "sonner";
import { AnalyticsMetricsSheet } from "#/components/analytics/analytics-metrics-sheet";
import { CheckStateMock } from "#/components/customize/check-state-mock";
import {
	PAGE_FRAME,
	SPLIT_FRAME,
} from "#/components/customize/customize-page-skeleton";
import { GithubCommentMock } from "#/components/customize/github-comment-mock";
import { ResponseConfigForm } from "#/components/customize/response-config-form";
import { VerdictToggle } from "#/components/customize/verdict-toggle";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import {
	type SaveQueueCommit,
	SaveQueueProvider,
	UnsavedChangesBar,
	useSaveQueue,
} from "#/components/save-queue";
import { useMediaQuery } from "#/hooks/use-media-query";
import { orgContextQueryOptions, orgRepoQueryOptions } from "#/lib/org.query";
import { saveRepoResponseConfig } from "#/lib/response.functions";
import {
	responseConfigQueryOptions,
	responseQueryKeys,
} from "#/lib/response.query";

const routeApi = getRouteApi("/$org/$repo/customize");

/**
 * Sample reasons for the preview — real rule outputs (the snapshot corpus's
 * wording), with rule ids so non-full modes resolve the catalog labels. The
 * preview calls the SAME `renderVerdictComment` and `checkSummary` the worker
 * posts with — preview equals production.
 */
const SAMPLE_REASONS: CommentReason[] = [
	{
		text: "your account is 2 days old",
		remedy: "wait",
		waitHint: "it clears in 5 days",
		ruleId: "account-age",
	},
	{
		text: "it adds 2 crypto addresses in DONATE.md",
		remedy: "revise",
		ruleId: "crypto-address",
	},
];

const TEMPLATE_PLACEHOLDER = "blocked: {{ruleName}}\n\n{{runUrl}}";

/**
 * The save-queue key space: one flat, primitive-valued key per writing
 * control, so default equality noop-clears and the bar's count is per
 * control. All SIX writers route through these keys — the three verdict
 * groups, the shape pills, the rule-names switch, the template editor.
 */
function flattenConfig(config: ResponseConfig): Record<string, unknown> {
	return {
		onSuccess: config.onSuccess,
		onBlock: config.onBlock,
		moderationQueued: config.moderationQueued,
		"blockComment.mode": config.blockComment.mode,
		"blockComment.showRuleName": config.blockComment.showRuleName,
		"blockComment.template": config.blockComment.template,
	};
}

function unflattenConfig(flat: Record<string, unknown>): ResponseConfig {
	return {
		onSuccess: flat.onSuccess,
		onBlock: flat.onBlock,
		moderationQueued: flat.moderationQueued,
		blockComment: {
			mode: flat["blockComment.mode"],
			showRuleName: flat["blockComment.showRuleName"],
			template: flat["blockComment.template"],
		},
	} as ResponseConfig;
}

function previewBody(config: ResponseConfig, verdict: Verdict): string | null {
	if (!wantsComment(config, verdict)) {
		return null;
	}
	// An untouched custom template previews the placeholder's result — the
	// bubble always shows a real end state, never an empty comment.
	const blockComment =
		config.blockComment.mode === "custom" &&
		config.blockComment.template.trim() === ""
			? { ...config.blockComment, template: TEMPLATE_PLACEHOLDER }
			: config.blockComment;
	return renderVerdictComment(
		{
			verdict,
			contributorLogin: "contributor",
			reasons: verdict === "block" ? SAMPLE_REASONS : [],
			runUrl: "https://tripwire.sh/runs/sample",
			badgeUrl: BADGE_PATH,
		},
		blockComment,
	);
}

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

	// The ONE persisted action: overlay the batch on the saved config, one
	// server call, one toast. Invalidation happens on SUCCESS ONLY — a failed
	// commit keeps the queue, and the pending overlay keeps the user's edits
	// on screen instead of snapping back to saved.
	const commitBatch: SaveQueueCommit = async (pending) => {
		if (!savedConfig) {
			return { error: "not loaded yet" };
		}
		const next = unflattenConfig({ ...flattenConfig(savedConfig), ...pending });
		try {
			const result = await saveRepoResponseConfig({
				data: { org, repoId, config: next },
			});
			if (result && "error" in result) {
				toast(result.error);
				return { error: result.error };
			}
		} catch {
			toast("could not save changes. try again.");
			return { error: "save failed" };
		}
		toast("changes saved.");
		await queryClient.invalidateQueries({
			queryKey: responseQueryKeys.config(org, repoId),
		});
		return { ok: true };
	};

	return (
		<SaveQueueProvider
			commit={commitBatch}
			savedValues={savedConfig ? flattenConfig(savedConfig) : {}}
		>
			<CustomizePageInner isAdmin={isAdmin} loaded={Boolean(savedConfig)} />
		</SaveQueueProvider>
	);
}

function CustomizePageInner({
	isAdmin,
	loaded,
}: {
	isAdmin: boolean;
	loaded: boolean;
}) {
	const { valueFor, setField } = useSaveQueue();
	// The previewed verdict: set directly by the switcher, and followed by
	// whichever verdict's controls are being touched (the selection link).
	const [verdict, setVerdict] = useState<Verdict>("block");
	const isDesktop = useMediaQuery("(min-width: 768px)");
	const [sheetOpen, setSheetOpen] = useState(false);

	// Effective config = saved + pending overlay. Controls and the preview
	// both render from it, so queued edits show everywhere before they save.
	const config = loaded
		? unflattenConfig({
				onSuccess: valueFor("onSuccess"),
				onBlock: valueFor("onBlock"),
				moderationQueued: valueFor("moderationQueued"),
				"blockComment.mode": valueFor("blockComment.mode"),
				"blockComment.showRuleName": valueFor("blockComment.showRuleName"),
				"blockComment.template": valueFor("blockComment.template"),
			})
		: null;

	// The form emits whole configs; the adapter fans them into per-key queue
	// writes. setField noop-clears, so re-toggling back to saved empties the
	// bar. Both form channels land here — nothing on this page writes to the
	// server while the provider is mounted.
	const onConfigChange = (next: ResponseConfig) => {
		for (const [key, value] of Object.entries(flattenConfig(next))) {
			setField(key, value);
		}
	};

	const body = config ? previewBody(config, verdict) : null;
	const checkPosted = config ? wantsCheck(config, verdict) : true;

	const form = config ? (
		<ResponseConfigForm
			canEdit={isAdmin}
			config={config}
			onChange={onConfigChange}
			onDraft={onConfigChange}
			onInteract={setVerdict}
		/>
	) : null;

	const preview = config ? (
		<div className="flex flex-col gap-4">
			<VerdictToggle onChange={setVerdict} value={verdict} />
			<GithubCommentMock body={body} />
			<CheckStateMock
				posted={checkPosted}
				reasons={verdict === "block" ? SAMPLE_REASONS : []}
				verdict={verdict}
			/>
		</div>
	) : null;

	const previewHeader = (
		<header className="shrink-0 bg-surface-1 px-3.5 py-3">
			<h2 className="font-medium text-sm">Preview</h2>
			<p className="text-muted-foreground text-xs">
				the pull request as this verdict leaves it.
			</p>
		</header>
	);

	const pageHeader = (
		<header className="flex shrink-0 flex-col gap-1">
			<h1 className="font-semibold text-2xl tracking-tight">Customize</h1>
			<p className="text-muted-foreground text-sm">
				what tripwire says and does when a verdict lands.
			</p>
		</header>
	);

	return (
		<DashboardLayout counts={{}}>
			{isDesktop ? (
				<div className={PAGE_FRAME}>
					{pageHeader}
					<div className={SPLIT_FRAME}>
						<section className="flex min-h-0 flex-col overflow-hidden rounded-xl border bg-card md:w-96 md:shrink-0">
							<header className="shrink-0 bg-surface-1 px-3.5 py-3">
								<h2 className="font-medium text-sm">Configuration</h2>
								<p className="text-muted-foreground text-xs">
									pick each verdict's surfaces. the preview follows what you
									touch.
								</p>
							</header>
							<div className="min-h-0 flex-1 overflow-y-auto p-4">{form}</div>
						</section>
						<section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card">
							{previewHeader}
							<div className="min-h-0 flex-1 overflow-y-auto p-4">
								{preview}
							</div>
						</section>
					</div>
				</div>
			) : (
				/* The analytics-sheet anatomy: a full-height page root, padded
				   content above, and the sheet as a DIRECT sibling at the bottom —
				   full-bleed, flush with the shell's bottom edge, in-flow so
				   opening pushes the content up instead of covering it. */
				<div className="relative flex h-full flex-col">
					<div className="flex min-h-0 flex-1 flex-col gap-4 px-5 pt-6 pb-3">
						{pageHeader}
						{/* The switcher (top) and check row (bottom) pin as fixed
						    bands; only the comment scrolls between them. With the
						    drawer open the preview shrinks, and all three must stay
						    visible at any height. */}
						<section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card">
							{previewHeader}
							{config ? (
								<>
									<div className="shrink-0 px-4 pt-4">
										<VerdictToggle onChange={setVerdict} value={verdict} />
									</div>
									<div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
										<GithubCommentMock body={body} />
									</div>
									<div className="shrink-0 px-4 pb-4">
										<CheckStateMock
											posted={checkPosted}
											reasons={verdict === "block" ? SAMPLE_REASONS : []}
											verdict={verdict}
										/>
									</div>
								</>
							) : null}
						</section>
					</div>
					<AnalyticsMetricsSheet
						closeLabel="Close Configuration"
						onOpenChange={setSheetOpen}
						open={sheetOpen}
						openLabel="show configuration"
					>
						{/* The cap IS the composition: the drawer never takes more than
						    55dvh, so the switcher, comment top, and check row stay live
						    above it while editing. Tune the class, never remove it. */}
						<div className="max-h-[55dvh] overflow-y-auto p-5">{form}</div>
					</AnalyticsMetricsSheet>
				</div>
			)}
			<UnsavedChangesBar />
		</DashboardLayout>
	);
}
