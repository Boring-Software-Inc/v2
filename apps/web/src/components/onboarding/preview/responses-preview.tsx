import type {
	OnboardingRepo,
	RedactionPolicy,
	ResponseConfig,
} from "@tripwire/contracts";
import { Icon } from "@tripwire/ui/icon";
import { Skeleton } from "@tripwire/ui/skeleton";
import { PreviewApp } from "#/components/onboarding/preview/preview-app";
import { BLOCK_META } from "#/components/responses/blocks/block-catalog";
import { GithubCommentMock } from "#/components/responses/github-comment-mock";
import {
	OUTCOMES,
	outcomeBlocks,
	outcomeMeta,
	responsePreview,
} from "#/components/responses/responses-model";

const BLOCK_OUTCOME = outcomeMeta("block");

/**
 * The repo's Responses page on the Block tab: the blocks a block response is
 * made of, and the review Tripwire would post, rendered by the same planner
 * the real page uses so a switch on the left changes it here.
 */
export function ResponsesPreviewPage({
	org,
	repo,
	config,
	policy,
}: {
	org: string;
	repo: OnboardingRepo | null;
	config: ResponseConfig | null;
	policy: RedactionPolicy;
}) {
	const blocks = config ? outcomeBlocks(config, BLOCK_OUTCOME) : [];
	const preview = config
		? responsePreview(config, BLOCK_OUTCOME, policy, "outsider", repo?.forge)
		: null;
	const comment =
		preview?.outputs
			.flatMap((output) => (output.body ? [output.body] : []))
			.join("\n\n") ?? "";
	return (
		<PreviewApp
			active="responses"
			collapsed
			forge={repo?.forge}
			repo={repo?.fullName ?? null}
			url={{
				host: "app.tripwire.sh",
				path: repo ? `/${org}/${repo.name}/responses` : `/${org}/home`,
			}}
		>
			<div data-layout-role="onboarding-responses-page">
				<aside data-part="builder">
					<div data-part="tabs">
						{OUTCOMES.map((outcome) => (
							<span
								data-selected={outcome.value === "block" ? "true" : "false"}
								key={outcome.value}
							>
								{outcome.label}
							</span>
						))}
					</div>
					<div data-part="blocks">
						<span data-part="heading">Response blocks</span>
						{config ? (
							blocks.map((block) => {
								const meta = BLOCK_META[block.type];
								return (
									<div data-part="block" key={block.id}>
										<Icon icon={meta.icon} size={16} />
										<span data-part="text">
											<span data-part="label">{meta.label}</span>
											<span data-part="description">{meta.description}</span>
										</span>
									</div>
								);
							})
						) : (
							<Skeleton />
						)}
					</div>
				</aside>
				<div data-part="stage">
					{preview ? (
						<GithubCommentMock body={preview.posting ? comment : null} />
					) : null}
				</div>
			</div>
		</PreviewApp>
	);
}
