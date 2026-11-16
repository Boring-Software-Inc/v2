import type { WorkflowDefinition } from "@tripwire/contracts";
import { CopyButton } from "@tripwire/ui/copy-button";
import {
	type CustomRuleDisplay,
	workflowToMarkdown,
} from "#/lib/workflow-markdown";

/**
 * Copy the whole workflow as markdown. Serializes from the loaded
 * (secret-redacted) definition, and the serializer never emits a url or
 * signing secret by construction, so the clipboard cannot carry a webhook or
 * discord destination. The button confirms the copy in place.
 */
export function CopyWorkflowButton({
	definition,
	customRules,
}: {
	definition: WorkflowDefinition;
	customRules: readonly CustomRuleDisplay[];
}) {
	return (
		<span className="shrink-0">
			<CopyButton
				label="workflow as Markdown"
				showLabel={false}
				variant="ghost"
				size="small"
				value={() => workflowToMarkdown(definition, customRules)}
			/>
		</span>
	);
}
