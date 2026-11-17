import {
	closeGifSchema,
	postCommentParamsSchema,
	type WorkflowNode,
} from "@tripwire/contracts";
import { Comment, Icon } from "@tripwire/ui/icon";
import { Caption, Label } from "@tripwire/ui/typography";

interface PostCommentNodeProps {
	node: Extract<WorkflowNode, { type: "action" }>;
	onEdit: () => void;
}

export function PostCommentNode({ node, onEdit }: PostCommentNodeProps) {
	const message = postCommentParamsSchema.shape.message
		.catch("")
		.parse(node.params?.message);
	const parsedGif = closeGifSchema.safeParse(node.params?.gif);
	const gif = parsedGif.success ? parsedGif.data : null;

	return (
		<>
			<div className="panel" data-layout-role="post-comment-panel">
				<button
					aria-label="Edit comment"
					data-layout-role="post-comment-content"
					onClick={onEdit}
					type="button"
				>
					{message ? (
						<p data-layout-role="post-comment-message">{message}</p>
					) : (
						<p data-empty data-layout-role="post-comment-message">
							Write a comment
						</p>
					)}
					{gif ? (
						<img
							alt={gif.title || "GIF"}
							data-layout-role="post-comment-gif"
							height={gif.height}
							src={gif.url}
							width={gif.width}
						/>
					) : null}
				</button>
			</div>
			<div className="shell-foot" data-layout-role="post-comment-footer">
				<span data-layout-role="post-comment-footer-label">
					<Icon icon={Comment} />
					<Label>Post comment</Label>
				</span>
				<Caption>Action</Caption>
			</div>
		</>
	);
}
