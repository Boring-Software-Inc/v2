import { DndContext, DragOverlay } from "@dnd-kit/core";
import type {
	RedactionPolicy,
	ResponseBlock,
	ResponseConfig,
} from "@tripwire/contracts";
import { variableHidden } from "@tripwire/contracts";
import { Button } from "#/components/glaze/ui/button";
import { Switch } from "#/components/glaze/ui/switch";
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

	const setPosting = (on: boolean) =>
		setField(outcome.surface, on ? "comment" : "silent");
	const startPosting = () => setPosting(true);

	const dragged = builder.drag?.item;
	const liftedOutput =
		dragged?.source === "canvas"
			? outputs.find((output) => output.block.id === dragged.id)
			: undefined;

	return (
		<DndContext {...dnd}>
			<BlockColumn
				builder={builder}
				outcome={outcome.value}
				readOnly={readOnly}
			/>
			<ResponsesPreview
				canvas={
					<div className="flex flex-col gap-2" data-region="comment">
						{posting && plan.comment !== "upsert" ? (
							<p className="type-body-sm text-text-2 sm:ms-13">
								Tripwire posts only the review.
							</p>
						) : null}
						<GithubCommentMock
							body={posting ? "" : null}
							edited={outcome.edited}
							editor={
								<BlockCanvas
									builder={builder}
									org={org}
									outputs={outputs}
									readOnly={readOnly}
									rulesHidden={variableHidden("failed-rules", preview.lens)}
								/>
							}
							headerAction={
								canEdit ? (
									<Switch
										aria-label="Post a comment"
										checked={posting}
										onCheckedChange={setPosting}
										size="sm"
									/>
								) : undefined
							}
							silentAction={
								canEdit ? (
									<Button onClick={startPosting} size="sm" variant="secondary">
										Post a comment
									</Button>
								) : undefined
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
