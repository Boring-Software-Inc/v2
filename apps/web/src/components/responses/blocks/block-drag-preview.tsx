import { DragHandle, type GlazeIcon, Icon } from "#/components/glaze/icon";
import { CommentMarkdown } from "#/components/responses/github-comment-mock";

export type BlockDragPreviewProps =
	| { source: "canvas"; label: string; body: string | null }
	| { source: "palette"; label: string; icon: GlazeIcon };

const LIFT =
	"flex w-fit max-w-120 cursor-grabbing items-center gap-1.5 rounded-panel bg-paper py-1.5 ps-2 pe-2.5 type-body text-text-1 shadow-[0_6px_16px_var(--ink-10)] ring-1 ring-line-control";

export function BlockDragPreview(props: BlockDragPreviewProps) {
	if (props.source === "palette") {
		return (
			<div className={LIFT}>
				<Icon className="text-text-2" icon={props.icon} />
				<span className="type-label">{props.label}</span>
			</div>
		);
	}
	return (
		<div className={LIFT}>
			<Icon className="shrink-0 text-text-3" icon={DragHandle} />
			<div className="line-clamp-2 min-w-0">
				{props.body ? <CommentMarkdown body={props.body} /> : props.label}
			</div>
		</div>
	);
}
