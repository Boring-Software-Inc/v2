import type { ResponseBlockType } from "@tripwire/contracts";
import { DragHandle, Icon, type IconGlyph } from "@tripwire/ui/icon";
import { EditorBlockSummary } from "#/components/responses/blocks/editor-block-summary";

const LOCAL_APPEARANCE = {
	canvas: "min-h-14 w-full max-w-[calc(100vw-2rem)]",
	palette: "w-fit text-text-2",
	node17_1: "type-label",
	node23_2: "shrink-0 text-text-3",
	node26_3: "flex-1",
} as const;

export type BlockDragPreviewProps =
	| { source: "canvas"; type: ResponseBlockType }
	| { source: "palette"; label: string; icon: IconGlyph };

const LIFT =
	"flex max-w-120 cursor-grabbing items-center gap-1.5 rounded-tag bg-paper py-1.5 ps-2 pe-2.5 type-body text-text-1 ring-1 ring-line-control";

export function BlockDragPreview(props: BlockDragPreviewProps) {
	if (props.source === "palette") {
		return (
			<div className={`${LIFT} ${LOCAL_APPEARANCE.palette}`}>
				<Icon icon={props.icon} />
				<span className={LOCAL_APPEARANCE.node17_1}>{props.label}</span>
			</div>
		);
	}
	return (
		<div className={`${LIFT} ${LOCAL_APPEARANCE.canvas}`}>
			<span className={LOCAL_APPEARANCE.node23_2}>
				<Icon icon={DragHandle} />
			</span>
			<EditorBlockSummary
				className={LOCAL_APPEARANCE.node26_3}
				type={props.type}
			/>
		</div>
	);
}
