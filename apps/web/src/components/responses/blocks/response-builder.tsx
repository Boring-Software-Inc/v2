import { DndContext, DragOverlay } from "@dnd-kit/core";
import type {
	RedactionPolicy,
	ResponseBlock,
	ResponseConfig,
} from "@tripwire/contracts";
import {
	defaultHelpContent,
	lensLevel,
	variableHidden,
} from "@tripwire/contracts";
import { Button } from "@tripwire/ui/button";
import { Sheet } from "@tripwire/ui/drawer";
import { Add, Icon } from "@tripwire/ui/icon";
import { Switch } from "@tripwire/ui/switch";
import { useId } from "react";
import { BlockCanvas } from "#/components/responses/blocks/block-canvas";
import { BLOCK_META } from "#/components/responses/blocks/block-catalog";
import { BlockColumn } from "#/components/responses/blocks/block-column";
import { BlockDragPreview } from "#/components/responses/blocks/block-drag-preview";
import { useBlockBuilder } from "#/components/responses/blocks/use-block-builder";
import { useBlockDnd } from "#/components/responses/blocks/use-block-dnd";
import { GithubCommentMock } from "#/components/responses/github-comment-mock";
import {
	blockKey,
	encodeBlocks,
	type OutcomeMeta,
	outcomeBlocks,
	responsePreview,
	sampleInput,
} from "#/components/responses/responses-model";
import { ResponsesPreview } from "#/components/responses/responses-preview";
import { sampleRunFor } from "#/components/responses/sample-run";
import type { useSaveQueue } from "#/components/save-queue";

export interface ResponseBuilderProps {
	outcome: OutcomeMeta;
	config: ResponseConfig;
	policy: RedactionPolicy;
	canEdit: boolean;
	org: string;
	setField: ReturnType<typeof useSaveQueue>["setField"];
}

export function ResponseBuilder({
	outcome,
	config,
	policy,
	canEdit,
	org,
	setField,
}: ResponseBuilderProps) {
	const save = (next: ResponseBlock[]) =>
		setField(blockKey(outcome), encodeBlocks(next));
	const builder = useBlockBuilder(outcomeBlocks(config, outcome), save);
	const dnd = useBlockDnd(builder);
	const { view } = builder;
	const preview = responsePreview(config, outcome, policy, view.viewer);
	const { outputs, plan, posting } = preview;
	const readOnly = !canEdit;
	const rulesHidden = variableHidden("failed-rules", preview.lens);
	const helpDefaultContent = defaultHelpContent(
		sampleInput(outcome).reasons,
		lensLevel(preview.lens),
	);
	const postingLabelId = useId();

	const setPosting = (on: boolean) =>
		setField(outcome.surface, on ? "comment" : "silent");
	const dragged = builder.drag?.item;
	const liftedOutput =
		dragged?.source === "canvas"
			? outputs.find((output) => output.block.id === dragged.id)
			: undefined;

	return (
		<DndContext {...dnd}>
			<div className="relative min-h-0" data-layout-role="response-builder">
				<ResponsesPreview
					action={
						canEdit ? (
							<div className="flex w-full items-center composition-gap-standard sm:min-w-0 sm:flex-1">
								{builder.full ? null : (
									<Button
										onAction={() => builder.browse()}
										size="small"
										variant="secondary"
									>
										<Icon icon={Add} />
										Add block
									</Button>
								)}
								<div
									className="composition-push-end flex shrink-0 items-center composition-gap-standard"
									data-layout-role="response-posting-control"
								>
									<span
										className="content-label-small tone-content-secondary"
										id={postingLabelId}
									>
										Post a comment
									</span>
									<Switch
										ariaLabelledBy={postingLabelId}
										checked={posting}
										onCheckedChange={setPosting}
										size="small"
									/>
								</div>
							</div>
						) : undefined
					}
					canvas={
						<div
							className="flex flex-col composition-gap-standard"
							data-region="comment"
						>
							{posting && plan.comment !== "upsert" ? (
								<p className="content-body-small tone-content-secondary composition-support-indent">
									Tripwire posts no separate PR comment. These blocks appear in
									the GitHub review.
								</p>
							) : null}
							<GithubCommentMock
								action={
									posting && plan.comment !== "upsert" ? "review" : "comment"
								}
								body={posting ? "" : null}
								edited={outcome.edited}
								editor={
									<BlockCanvas
										builder={builder}
										outputs={outputs}
										readOnly={readOnly}
									/>
								}
							/>
						</div>
					}
					check={preview.check}
					onView={builder.setView}
					outcome={outcome}
					plan={plan}
					run={sampleRunFor(outcome, plan, preview.check)}
					runPageLevel={preview.runPageLevel}
					view={view}
				/>
			</div>
			<Sheet
				bodyInset="content"
				onOpenChange={builder.showPalette}
				open={builder.paletteOpen}
				showFooter={false}
				showHeader={false}
				title={builder.selected ? "Block settings" : "Add block"}
			>
				<BlockColumn
					builder={builder}
					key={builder.selectedId ?? builder.insertIndex ?? "palette"}
					helpDefaultContent={helpDefaultContent}
					org={org}
					outcome={outcome.value}
					readOnly={readOnly}
					rulesHidden={rulesHidden}
				/>
			</Sheet>
			<DragOverlay dropAnimation={null}>
				{dragged?.source === "palette" ? (
					<BlockDragPreview
						icon={BLOCK_META[dragged.type].icon}
						label={BLOCK_META[dragged.type].label}
						source="palette"
					/>
				) : null}
				{liftedOutput ? (
					<BlockDragPreview
						body={liftedOutput.body}
						label={BLOCK_META[liftedOutput.block.type].label}
						source="canvas"
					/>
				) : null}
			</DragOverlay>
		</DndContext>
	);
}
