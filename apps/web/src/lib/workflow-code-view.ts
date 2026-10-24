import {
	type WorkflowDefinition,
	workflowDefinitionSchema,
	workflowKeys,
	workflowToCode,
} from "@tripwire/contracts";

export type WorkflowCodeView =
	| {
			kind: "code";
			code: string;
			saved: string | null;
			warnings: string[];
			unsaved: boolean;
	  }
	| { kind: "refused"; reason: string };

export function workflowCodeView(
	current: WorkflowDefinition,
	saved: WorkflowDefinition,
): WorkflowCodeView {
	const parsed = workflowDefinitionSchema.safeParse(current);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		const where = issue?.path.join(".");
		return {
			kind: "refused",
			reason: `${where ? `${where}: ` : ""}${issue?.message ?? "the workflow is not valid"}`,
		};
	}
	const key = workflowKeys([saved]).get(saved.id);
	const result = workflowToCode(parsed.data, { key });
	if (!result.ok) {
		return { kind: "refused", reason: result.reason };
	}
	const before = workflowToCode(saved, { key });
	return {
		kind: "code",
		code: result.code,
		saved: before.ok ? before.code : null,
		warnings: result.warnings,
		unsaved: !before.ok || before.code !== result.code,
	};
}
