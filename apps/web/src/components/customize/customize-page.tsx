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
	responseConfigSchema,
	wantsCheck,
	wantsComment,
} from "@tripwire/contracts";
import { useState } from "react";
import { CheckStateMock } from "#/components/customize/check-state-mock";
import {
	PAGE_FRAME,
	SPLIT_FRAME,
} from "#/components/customize/customize-page-skeleton";
import { GithubCommentMock } from "#/components/customize/github-comment-mock";
import { ResponseConfigForm } from "#/components/customize/response-config-form";
import { VerdictToggle } from "#/components/customize/verdict-toggle";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#/components/glaze/ui/collapsible";
import { toast } from "#/components/glaze/ui/toast";
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
 * control. Every writer routes through these keys — the three verdict groups,
 * the block shape pills + rule-names switch + template editor, and the
 * per-outcome custom text + details-button toggle for pass / block / review.
 */
function flattenConfig(config: ResponseConfig): Record<string, unknown> {
	return {
		onSuccess: config.onSuccess,
		onBlock: config.onBlock,
		moderationQueued: config.moderationQueued,
		"blockComment.mode": config.blockComment.mode,
		"blockComment.showRuleName": config.blockComment.showRuleName,
		"blockComment.template": config.blockComment.template,
		// Per-outcome custom text + button toggle (§customize). Independent per
		// verdict — block and review carry their own message.
		"passComment.customText": config.passComment.customText,
		"passComment.showDetailsButton": config.passComment.showDetailsButton,
		"blockComment.customText": config.blockComment.customText,
		"blockComment.showDetailsButton": config.blockComment.showDetailsButton,
		"reviewComment.customText": config.reviewComment.customText,
		"reviewComment.showDetailsButton": config.reviewComment.showDetailsButton,
		failClosedFallback: config.failClosedFallback,
	};
}

// Parse (not cast) so a flat map missing any key — a saved row that predates a
// field, or a key list that drifted from flattenConfig — resolves to the schema
// default instead of leaking `undefined` into a `.trim()` downstream.
function unflattenConfig(flat: Record<string, unknown>): ResponseConfig {
	return responseConfigSchema.parse({
		onSuccess: flat.onSuccess,
		onBlock: flat.onBlock,
		moderationQueued: flat.moderationQueued,
		passComment: {
			customText: flat["passComment.customText"],
			showDetailsButton: flat["passComment.showDetailsButton"],
		},
		blockComment: {
			mode: flat["blockComment.mode"],
			showRuleName: flat["blockComment.showRuleName"],
			template: flat["blockComment.template"],
			customText: flat["blockComment.customText"],
			showDetailsButton: flat["blockComment.showDetailsButton"],
		},
		reviewComment: {
			customText: flat["reviewComment.customText"],
			showDetailsButton: flat["reviewComment.showDetailsButton"],
		},
		/**
		 * Must round-trip. Absent here, the schema default (true) rebuilt the
		 * config on every save, so editing an unrelated control silently switched
		 * the safety net back on for a repo that had turned it off.
		 */
		failClosedFallback: flat.failClosedFallback,
	});
}

function previewBody(config: ResponseConfig, verdict: Verdict): string | null {
	if (!wantsComment(config, verdict)) {
		return null;
	}
	// An untouched custom template previews the placeholder's result — the
	// bubble always shows a real end state, never an empty comment.
	const previewConfig =
		config.blockComment.mode === "custom" &&
		config.blockComment.template.trim() === "" &&
		config.blockComment.customText.trim() === ""
			? {
					...config,
					blockComment: {
						...config.blockComment,
						template: TEMPLATE_PLACEHOLDER,
					},
				}
			: config;
	return renderVerdictComment(
		{
			verdict,
			contributorLogin: "contributor",
			reasons: verdict === "block" ? SAMPLE_REASONS : [],
			runUrl: "https://tripwire.sh/runs/sample",
			badgeUrl: BADGE_PATH,
		},
		previewConfig,
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
				toast.fail(result.error);
				return { error: result.error };
			}
		} catch {
			toast.fail("Could not save changes. Try again.");
			return { error: "save failed" };
		}
		toast.success("Changes saved.");
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
				"passComment.customText": valueFor("passComment.customText"),
				"passComment.showDetailsButton": valueFor(
					"passComment.showDetailsButton",
				),
				"blockComment.customText": valueFor("blockComment.customText"),
				"blockComment.showDetailsButton": valueFor(
					"blockComment.showDetailsButton",
				),
				"reviewComment.customText": valueFor("reviewComment.customText"),
				"reviewComment.showDetailsButton": valueFor(
					"reviewComment.showDetailsButton",
				),
				failClosedFallback: valueFor("failClosedFallback"),
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
		<header className="shrink-0 border-line-faint border-b p-3">
			<h2 className="type-label">Preview</h2>
			<p className="type-body-sm text-text-2">
				The pull request as this verdict leaves it.
			</p>
		</header>
	);

	const pageHeader = (
		<header className="flex shrink-0 flex-col gap-1">
			<h1 className="type-title">Customize</h1>
			<p className="type-body text-text-2">
				What Tripwire says and does when a verdict lands.
			</p>
		</header>
	);

	return (
		<DashboardLayout counts={{}}>
			{isDesktop ? (
				<div className={PAGE_FRAME}>
					{pageHeader}
					<div className={SPLIT_FRAME}>
						<section
							aria-labelledby="customize-configuration"
							className="shell flex min-h-0 flex-col md:w-96 md:shrink-0"
						>
							<div className="panel flex min-h-0 flex-1 flex-col">
								<header className="shrink-0 border-line-faint border-b p-3">
									<h2 className="type-label" id="customize-configuration">
										Configuration
									</h2>
									<p className="type-body-sm text-text-2">
										Pick each verdict's surfaces. The preview follows what you
										touch.
									</p>
								</header>
								<div className="min-h-0 flex-1 overflow-y-auto p-3">{form}</div>
							</div>
						</section>
						<section className="shell flex min-h-0 flex-1 flex-col">
							<div className="panel flex min-h-0 flex-1 flex-col">
								{previewHeader}
								<div className="min-h-0 flex-1 overflow-y-auto p-3">
									{preview}
								</div>
							</div>
						</section>
					</div>
				</div>
			) : (
				<div className="flex h-full flex-col">
					<div className="flex min-h-0 flex-1 flex-col gap-4 px-4 pt-6 pb-3">
						{pageHeader}
						<section className="shell flex min-h-0 flex-1 flex-col">
							<div className="panel flex min-h-0 flex-1 flex-col">
								{previewHeader}
								{config ? (
									<>
										<div className="shrink-0 px-3 pt-3">
											<VerdictToggle onChange={setVerdict} value={verdict} />
										</div>
										<div className="min-h-0 flex-1 overflow-y-auto p-3">
											<GithubCommentMock body={body} />
										</div>
										<div className="shrink-0 px-3 pb-3">
											<CheckStateMock
												posted={checkPosted}
												reasons={verdict === "block" ? SAMPLE_REASONS : []}
												verdict={verdict}
											/>
										</div>
									</>
								) : null}
							</div>
						</section>
					</div>
					<div className="shrink-0 border-line-faint border-t bg-page px-4 py-2">
						<Collapsible onOpenChange={setSheetOpen} open={sheetOpen}>
							<CollapsibleTrigger>Configuration</CollapsibleTrigger>
							<CollapsibleContent>
								<div className="max-h-[55dvh] overflow-y-auto py-3">{form}</div>
							</CollapsibleContent>
						</Collapsible>
					</div>
				</div>
			)}
			<UnsavedChangesBar />
		</DashboardLayout>
	);
}
