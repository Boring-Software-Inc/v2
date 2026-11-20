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
import { Card, CardContent } from "@tripwire/ui/card";
import { Drawer } from "@tripwire/ui/drawer";
import { useReducedMotion } from "motion/react";
import { type ReactNode, useState } from "react";
import { ConfirmDestructiveDialog } from "#/components/common/confirm-destructive-dialog";
import { BLOCK_META } from "#/components/responses/blocks/block-catalog";
import { BlockColumn } from "#/components/responses/blocks/block-column";
import { BlockDragPreview } from "#/components/responses/blocks/block-drag-preview";
import { useBlockBuilder } from "#/components/responses/blocks/use-block-builder";
import { useBlockDnd } from "#/components/responses/blocks/use-block-dnd";
import { OutcomeCarousel } from "#/components/responses/outcome-carousel";
import { RedactionSettings } from "#/components/responses/redaction-settings";
import { ResponseEditor } from "#/components/responses/response-editor";
import { ResponseGithubStage } from "#/components/responses/response-github-stage";
import {
	blockKey,
	encodeBlocks,
	type OutcomeMeta,
	outcomeBlocks,
	responsePreview,
	sampleInput,
} from "#/components/responses/responses-model";
import type { useSaveQueue } from "#/components/save-queue";

const LOCAL_APPEARANCE = {
	node87_1:
		"grid min-h-0 flex-1 grid-cols-[minmax(20rem,24rem)_minmax(0,1fr)] overflow-hidden bg-shell",
	node90_2: "min-h-0 overflow-y-auto border-e border-line-faint bg-shell",
	node95_3: "px-4 py-5",
	node107_4: "mt-4",
} as const;

export interface ResponseBuilderProps {
	outcome: OutcomeMeta;
	config: ResponseConfig;
	policy: RedactionPolicy;
	orgPolicy: RedactionPolicy;
	canEdit: boolean;
	org: string;
	onOutcomeChange: (value: string) => void;
	saveToolbar: ReactNode;
	setField: ReturnType<typeof useSaveQueue>["setField"];
}

export function ResponseBuilder({
	outcome,
	config,
	policy,
	orgPolicy,
	canEdit,
	org,
	onOutcomeChange,
	saveToolbar,
	setField,
}: ResponseBuilderProps) {
	const reduceMotion = useReducedMotion();
	const [removeId, setRemoveId] = useState<string | null>(null);
	const save = (next: ResponseBlock[]) =>
		setField(blockKey(outcome), encodeBlocks(next));
	const builder = useBlockBuilder(
		outcomeBlocks(config, outcome),
		save,
		canEdit,
	);
	const dnd = useBlockDnd(builder);
	const preview = responsePreview(config, outcome, policy, builder.view.viewer);
	const readOnly = !canEdit;
	const rulesHidden = variableHidden("failed-rules", preview.lens);
	const helpDefaultContent = defaultHelpContent(
		sampleInput(outcome).reasons,
		lensLevel(preview.lens),
	);
	const dragged = builder.drag?.item;
	const liftedOutput =
		dragged?.source === "canvas"
			? preview.outputs.find((output) => output.block.id === dragged.id)
			: undefined;
	const setPosting = (posting: boolean) =>
		setField(outcome.surface, posting ? "comment" : "silent");

	return (
		<DndContext {...dnd}>
			<div
				className={LOCAL_APPEARANCE.node87_1}
				data-layout-role="response-builder"
			>
				<aside className={LOCAL_APPEARANCE.node90_2}>
					<OutcomeCarousel
						onValueChange={onOutcomeChange}
						value={outcome.value}
					/>
					<div className={LOCAL_APPEARANCE.node95_3}>
						<ResponseEditor
							builder={builder}
							helpDefaultContent={helpDefaultContent}
							onPostingChange={setPosting}
							onRemoveBlock={setRemoveId}
							org={org}
							outputs={preview.outputs}
							posting={preview.posting}
							readOnly={readOnly}
							rulesHidden={rulesHidden}
						/>
						<div className={LOCAL_APPEARANCE.node107_4}>
							<Card>
								<CardContent>
									<RedactionSettings
										canEdit={canEdit}
										config={config}
										effective={policy}
										orgPolicy={orgPolicy}
										setField={setField}
									/>
								</CardContent>
							</Card>
						</div>
					</div>
				</aside>
				<ResponseGithubStage
					builder={builder}
					check={preview.check}
					edited={outcome.edited}
					outputs={preview.outputs}
					plan={preview.plan}
					posting={preview.posting}
					readOnly={readOnly}
					toolbar={saveToolbar}
				/>
			</div>
			<Drawer
				onOpenChange={builder.showPalette}
				open={builder.paletteOpen}
				showFooter={false}
				showHeader={false}
				title="Add block"
			>
				<BlockColumn
					builder={builder}
					helpDefaultContent={helpDefaultContent}
					org={org}
					outcome={outcome.value}
					readOnly={readOnly}
					rulesHidden={rulesHidden}
				/>
			</Drawer>
			<ConfirmDestructiveDialog
				confirmLabel="Remove block"
				description="This response block will be removed after you save the response."
				onConfirm={() => {
					if (removeId) builder.remove(removeId);
					return undefined;
				}}
				onOpenChange={(open) => {
					if (!open) setRemoveId(null);
				}}
				open={removeId !== null}
				pendingLabel="Removing"
				title="Remove this block?"
			/>
			<DragOverlay dropAnimation={reduceMotion ? null : undefined}>
				{dragged?.source === "palette" ? (
					<BlockDragPreview
						icon={BLOCK_META[dragged.type].icon}
						label={BLOCK_META[dragged.type].label}
						source="palette"
					/>
				) : null}
				{liftedOutput ? (
					<BlockDragPreview source="canvas" type={liftedOutput.block.type} />
				) : null}
			</DragOverlay>
		</DndContext>
	);
}
