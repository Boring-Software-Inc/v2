import { expect, test } from "bun:test";
import type { WorkflowNode } from "@tripwire/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { TriggerFlow } from "#/components/workflows/editor/schedule-flow";

const eventNode: Extract<WorkflowNode, { type: "trigger" }> = {
	id: "event-trigger",
	type: "trigger",
	kinds: ["change-request.opened", "push"],
};

test("TriggerFlow preserves event selection, field labels and semantic step states", () => {
	const updates: WorkflowNode[] = [];
	const html = renderToStaticMarkup(
		<TriggerFlow
			node={eventNode}
			readOnly={false}
			onUpdate={(next) => updates.push(next)}
		/>,
	);
	expect(updates).toEqual([]);
	expect(html).toContain('data-step="run"');
	expect(html).toContain('data-step="kinds"');
	expect(html.match(/data-status="answered"/g)).toHaveLength(4);
	expect(html).toContain("A change request opens");
	expect(html).toContain("Someone pushes");
	expect(html.match(/role="checkbox"[^>]*aria-checked="true"/g)).toHaveLength(
		2,
	);
	for (const label of ["Run", "When"]) {
		const id = html.match(new RegExp(`id="([^"]+)"[^>]*>${label}<`))?.[1];
		expect(id).toBeDefined();
		expect(html).toContain(`aria-labelledby="${id}"`);
	}
});

test("TriggerFlow readonly keeps event choices visible but disables native controls", () => {
	const html = renderToStaticMarkup(
		<TriggerFlow
			node={{ ...eventNode, kinds: [] }}
			readOnly
			onUpdate={() => {
				throw new Error("SSR must not update");
			}}
		/>,
	);
	expect(html).toContain('data-status="current"');
	expect(html).toContain("A change request opens");
	expect(
		html.match(/<input(?=[^>]*type="checkbox")(?=[^>]*disabled="")[^>]*>/g),
	).toHaveLength(5);
	expect(html.match(/role="radio"[^>]*aria-disabled="true"/g)).toHaveLength(2);
});
