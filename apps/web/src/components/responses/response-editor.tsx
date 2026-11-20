import type { BlockOutput } from "@tripwire/contracts";
import { Button } from "@tripwire/ui/button";
import { Card, CardContent } from "@tripwire/ui/card";
import { Add, Icon, TrashCan } from "@tripwire/ui/icon";
import { Switch } from "@tripwire/ui/switch";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useId } from "react";
import { BlockSettings } from "#/components/responses/blocks/block-settings";
import { EditorBlockList } from "#/components/responses/blocks/editor-block-list";
import type { BlockBuilder } from "#/components/responses/blocks/use-block-builder";

const LOCAL_APPEARANCE = {
	node44_1: "flex flex-col gap-3",
	node46_2: "flex items-start gap-3 px-3",
	node47_3: "min-w-0 flex-1",
	node48_4: "type-heading-sm",
	node51_5: "mt-0.5 type-body-sm text-text-2",
	node66_6: "flex items-center gap-3 rounded-panel px-3 py-2",
	node67_7: "min-w-0 flex-1",
	node68_8: "block type-label text-text-1",
	node71_9: "block type-caption text-text-2",
	node109_10: "mt-1 self-start",
} as const;

export interface ResponseEditorProps {
	builder: BlockBuilder;
	outputs: BlockOutput[];
	readOnly: boolean;
	org: string;
	rulesHidden: boolean;
	helpDefaultContent: string;
	posting: boolean;
	onPostingChange: (posting: boolean) => void;
	onRemoveBlock: (blockId: string) => void;
}

export function ResponseEditor({
	builder,
	outputs,
	readOnly,
	org,
	rulesHidden,
	helpDefaultContent,
	posting,
	onPostingChange,
	onRemoveBlock,
}: ResponseEditorProps) {
	const reduceMotion = useReducedMotion();
	const postingLabelId = useId();
	const selectedOutput = outputs.find(
		(output) => output.block.id === builder.selectedId,
	);

	return (
		<section
			aria-labelledby="response-blocks-title"
			className={LOCAL_APPEARANCE.node44_1}
		>
			<header className={LOCAL_APPEARANCE.node46_2}>
				<div className={LOCAL_APPEARANCE.node47_3}>
					<h2 className={LOCAL_APPEARANCE.node48_4} id="response-blocks-title">
						Response blocks
					</h2>
					<p className={LOCAL_APPEARANCE.node51_5}>
						Select a block to edit its output.
					</p>
				</div>
				{readOnly || builder.full ? null : (
					<Button
						leadingIcon={<Icon icon={Add} />}
						onAction={() => builder.browse()}
						size="small"
						variant="secondary"
					>
						Add block
					</Button>
				)}
			</header>
			<div className={LOCAL_APPEARANCE.node66_6}>
				<span className={LOCAL_APPEARANCE.node67_7}>
					<span className={LOCAL_APPEARANCE.node68_8} id={postingLabelId}>
						Post a comment
					</span>
					<span className={LOCAL_APPEARANCE.node71_9}>
						Publish these response blocks.
					</span>
				</span>
				<Switch
					ariaLabelledBy={postingLabelId}
					checked={posting}
					disabled={readOnly}
					onCheckedChange={onPostingChange}
					size="small"
				/>
			</div>
			<EditorBlockList
				builder={builder}
				outputs={outputs}
				readOnly={readOnly}
			/>
			<AnimatePresence initial={false} mode="wait">
				{selectedOutput ? (
					<motion.div
						animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
						exit={{ opacity: 0, filter: "blur(5px)", y: -4 }}
						id="response-block-settings"
						initial={{ opacity: 0, filter: "blur(5px)", y: 4 }}
						key={selectedOutput.block.id}
						transition={reduceMotion ? { duration: 0 } : { duration: 0.2 }}
					>
						<Card>
							<CardContent>
								<BlockSettings
									block={selectedOutput.block}
									helpDefaultContent={helpDefaultContent}
									onUpdate={builder.update}
									org={org}
									readOnly={readOnly}
									rulesHidden={rulesHidden}
								/>
								{readOnly ? null : (
									<div className={LOCAL_APPEARANCE.node109_10}>
										<Button
											leadingIcon={<Icon icon={TrashCan} />}
											onAction={() => onRemoveBlock(selectedOutput.block.id)}
											size="small"
											variant="secondary"
										>
											Remove block
										</Button>
									</div>
								)}
							</CardContent>
						</Card>
					</motion.div>
				) : null}
			</AnimatePresence>
		</section>
	);
}
