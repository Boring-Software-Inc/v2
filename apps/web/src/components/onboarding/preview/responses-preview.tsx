import type {
	OnboardingRepo,
	RedactionPolicy,
	ResponseConfig,
} from "@tripwire/contracts";
import { PreviewApp } from "#/components/onboarding/preview/preview-app";
import { ResponseBuilder } from "#/components/responses/blocks/response-builder";
import { PreviewLinkProvider } from "#/components/responses/preview-link";
import { outcomeMeta } from "#/components/responses/responses-model";
import { BuilderSkeleton } from "#/components/responses/responses-page-skeleton";

const BLOCK_OUTCOME = outcomeMeta("block");
/** Shown as an admin sees it; the window is inert and the step saves the
 * choices for real. */
const noOp = () => undefined;

/**
 * The repo's Responses page on the Block outcome: the page's own builder as
 * an admin sees it, fed the config the switches on the left describe, so its
 * block list and the comment preview change as they do.
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
	const forge = repo?.forge ?? null;
	return (
		<PreviewApp
			active="responses"
			collapsed
			forge={repo?.forge}
			repo={repo?.name ?? null}
			url={{
				host: "app.tripwire.sh",
				path: repo ? `/${org}/${repo.name}/responses` : `/${org}/home`,
			}}
		>
			<PreviewLinkProvider>
				<div data-layout-role="responses-shell">
					{config ? (
						<div data-layout-role="response-workspace">
							<ResponseBuilder
								canEdit
								config={config}
								forge={forge}
								onOutcomeChange={noOp}
								org={org}
								orgPolicy={policy}
								outcome={BLOCK_OUTCOME}
								policy={policy}
								saveToolbar={null}
								setField={noOp}
							/>
						</div>
					) : (
						<BuilderSkeleton forge={forge} />
					)}
				</div>
			</PreviewLinkProvider>
		</PreviewApp>
	);
}
