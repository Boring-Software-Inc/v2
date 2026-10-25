import { DndContext, DragOverlay } from "@dnd-kit/core";
import type {
	BlockLens,
	RedactionPolicy,
	ResponseBlock,
	ResponseConfig,
} from "@tripwire/contracts";
import {
	redactionLevelFor,
	renderBlockOutputs,
	variableHidden,
} from "@tripwire/contracts";
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
	postsComment,
	previewCheck,
	previewPlan,
	sampleInput,
} from "#/components/responses/responses-model";
import { ResponsesPreview } from "#/components/responses/responses-preview";
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

	const member = view.viewer === "member";
	const seen: RedactionPolicy = member ? { ...policy, level: 0 } : policy;
	const lens: BlockLens = {
		level: redactionLevelFor(policy, "comment"),
		showHelp: policy.showHelp,
		viewer: view.viewer,
	};
	const outputs = renderBlockOutputs(
		builder.blocks,
		sampleInput(outcome),
		lens,
	);
	const plan = previewPlan(config, outcome, seen);
	const posting = postsComment(config, outcome);
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
								At this redaction level, Tripwire posts only the review.
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
									rulesHidden={variableHidden("failed-rules", lens)}
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
				check={previewCheck(config, outcome, seen)}
				onView={builder.setView}
				outcome={outcome}
				plan={plan}
				runPageLevel={member ? 0 : redactionLevelFor(policy, "run-page")}
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
