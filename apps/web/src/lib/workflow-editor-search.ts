import { z } from "zod";

export const WORKFLOW_EDITOR_VIEWS = ["canvas", "code"] as const;

export type WorkflowEditorView = (typeof WORKFLOW_EDITOR_VIEWS)[number];

export const WORKFLOW_EDITOR_SEARCH_DEFAULTS = { view: "canvas" } as const;

export const workflowEditorSearchSchema = z.object({
	view: z
		.enum(WORKFLOW_EDITOR_VIEWS)
		.default(WORKFLOW_EDITOR_SEARCH_DEFAULTS.view)
		.catch(WORKFLOW_EDITOR_SEARCH_DEFAULTS.view),
});
