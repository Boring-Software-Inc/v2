import { z } from "zod";

export const issueCommentSchema = z.object({
	id: z.number(),
	body: z.string().nullish(),
	performed_via_github_app: z.object({ id: z.number() }).nullish(),
});

export type IssueComment = z.infer<typeof issueCommentSchema>;

export const issueCommentListSchema = z.array(issueCommentSchema);

export function isOwnMarkedComment(
	appId: number,
	comment: IssueComment,
	marker: string,
): boolean {
	return (
		comment.performed_via_github_app?.id === appId &&
		comment.body?.includes(marker) === true
	);
}
