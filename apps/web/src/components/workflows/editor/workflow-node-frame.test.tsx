import { describe, expect, test } from "bun:test";
import type { WorkflowNode } from "@tripwire/contracts";
import { ReactFlow } from "@xyflow/react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	AgentEnterContext,
	AgentWorkContext,
	type AgentWorkState,
} from "#/components/workflows/editor/agent-work-context";
import { TripwireNode } from "#/components/workflows/editor/node-card";
import {
	type Problem,
	ProblemsContext,
} from "#/components/workflows/editor/node-issues";
import {
	RuleGroupNode,
	SkipWhenNode,
} from "#/components/workflows/editor/rule-group-cards";
import {
	type RuleGroupsApi,
	RuleGroupsContext,
} from "#/components/workflows/editor/rule-groups-context";
import { WorkflowNodeFrame } from "#/components/workflows/editor/workflow-node-frame";

const WARNING: Problem = {
	key: "warning",
	rule: null,
	severity: "warning",
	step: "Account age",
	message: "This rule has no effect",
	nodeId: "rule",
	fixes: [],
};
const ERROR: Problem = {
	...WARNING,
	key: "error",
	severity: "error",
	message: "Connect this rule",
};
const RULE: WorkflowNode = {
	id: "rule",
	type: "rule",
	ref: "account-age@1",
	config: {},
};

function withProblems(children: ReactNode, problems: Problem[]) {
	return (
		<ProblemsContext.Provider
			value={{
				byNode: new Map([["rule", problems]]),
				byEdge: new Map(),
				onFix: () => undefined,
				onReveal: () => undefined,
			}}
		>
			{children}
		</ProblemsContext.Provider>
	);
}

function frame(selected: boolean, problems: Problem[]) {
	return renderToStaticMarkup(
		withProblems(
			<WorkflowNodeFrame nodeId="rule" selected={selected}>
				<span>Account age</span>
			</WorkflowNodeFrame>,
			problems,
		),
	);
}

describe("WorkflowNodeFrame", () => {
	for (const selected of [false, true]) {
		test(`no problems omits the problem mark, selected=${selected}`, () => {
			const html = frame(selected, []);
			expect(html.includes('data-selected="true"')).toBe(selected);
			expect(html).not.toContain("data-problem-status");
			expect(html).not.toContain('data-slot="status-mark"');
		});

		for (const [status, problems] of [
			["warn", [WARNING]],
			["fail", [ERROR]],
			["fail", [WARNING, ERROR]],
		] as const) {
			test(`${problems.length} problem(s) retain ${status} mark when selected=${selected}`, () => {
				const html = frame(selected, [...problems]);
				expect(html.includes('data-selected="true"')).toBe(selected);
				expect(html).toContain(`data-problem-status="${status}"`);
				expect(html).toContain(`data-status="${status}"`);
				expect(html).toContain(
					`aria-label="${problems.map((problem) => problem.message).join(". ")}"`,
				);
			});
		}
	}

	test("problems are resolved by node identity, not inherited from another node", () => {
		const html = renderToStaticMarkup(
			withProblems(
				<WorkflowNodeFrame nodeId="other" selected={false}>
					<span>Other rule</span>
				</WorkflowNodeFrame>,
				[ERROR],
			),
		);
		expect(html).not.toContain("data-problem-status");
	});

	test("corner-output geometry and drop states are finite semantic state", () => {
		for (const dropState of ["origin", "open", "closed"] as const) {
			const html = renderToStaticMarkup(
				<WorkflowNodeFrame
					nodeId="rule"
					selected={false}
					cornerOutput
					dropState={dropState}
				>
					<span>Account age</span>
				</WorkflowNodeFrame>,
			);
			expect(html).toContain('data-corner-output="true"');
			expect(html).toContain(`data-drop-node="${dropState}"`);
		}
		expect(frame(false, [])).not.toContain("data-corner-output");
		expect(frame(false, [])).not.toContain("data-drop-node");
	});

	test("agent activity is resolved by identity and stays inside its measured frame", () => {
		const work: AgentWorkState = {
			touches: new Map([
				[
					"rule",
					{
						id: "rule",
						agent: "workflow-editor-test",
						action: "edit",
						at: "2026-10-27T12:00:00Z",
					},
				],
			]),
			motion: "reduced",
		};
		const html = renderToStaticMarkup(
			<AgentWorkContext.Provider value={work}>
				<WorkflowNodeFrame nodeId="rule" selected={false}>
					<span>Account age</span>
				</WorkflowNodeFrame>
				<WorkflowNodeFrame nodeId="other" selected={false}>
					<span>Other rule</span>
				</WorkflowNodeFrame>
			</AgentWorkContext.Provider>,
		);
		expect(html).toMatch(
			/<div data-layout-role="workflow-node-frame"><canvas[^>]*data-agent-outline="on"/,
		);
		expect(html.match(/data-agent-outline="on"/g)).toHaveLength(1);
	});

	test("agent entry dissolve remains a sibling outside the measured frame", () => {
		const html = renderToStaticMarkup(
			<AgentEnterContext.Provider value={new Map([["rule", 0]])}>
				<WorkflowNodeFrame nodeId="rule" selected={false}>
					<span>Account age</span>
				</WorkflowNodeFrame>
			</AgentEnterContext.Provider>,
		);
		expect(html).toMatch(/<\/span><\/div><canvas[^>]*data-agent-dissolve=""/);
	});
});

const GROUPS: RuleGroupsApi = {
	view: {
		cards: new Map([
			[
				"rule",
				{
					kind: "group",
					id: "rule",
					ruleIds: ["member"],
					gateId: null,
					unlessId: null,
					skipId: null,
					triggerIds: [],
				},
			],
		]),
		memberOf: new Map(),
		hiddenEdges: new Set(),
		viewEdges: [],
	},
	nodes: new Map([["member", { ...RULE, id: "member" }]]),
	choices: [],
	readOnly: false,
	addRule: () => undefined,
	removeRule: () => undefined,
	addCheck: () => undefined,
	removeCheck: () => undefined,
	setMode: () => undefined,
	attachSkip: () => undefined,
	removeSkip: () => undefined,
	select: () => undefined,
};

function renderNode(type: string, groups = GROUPS, node = RULE) {
	return renderToStaticMarkup(
		withProblems(
			<RuleGroupsContext.Provider value={groups}>
				<ReactFlow
					nodes={[
						{
							id: "rule",
							type,
							data: { node },
							position: { x: 0, y: 0 },
							width: 224,
							height: 100,
							selected: true,
						},
					]}
					nodeTypes={{
						tripwire: TripwireNode,
						ruleGroup: RuleGroupNode,
						skipWhen: SkipWhenNode,
					}}
					width={800}
					height={600}
				/>
			</RuleGroupsContext.Provider>,
			[ERROR],
		),
	);
}

test("TripwireNode keeps source/target identity and both output slots in the shared frame", () => {
	const html = renderNode("tripwire");
	expect(html).toContain('data-layout-role="workflow-node-frame"');
	expect(html).toContain('data-problem-status="fail"');
	expect(html).toContain('data-selected="true"');
	expect(html).toContain('data-corner-output="true"');
	expect(html).toContain('data-handleid="fail"');
	expect(html).toContain('data-port-slot="corner"');
	expect(html).toContain('data-id="1-rule-null-target"');
	expect(html).toContain('data-id="1-rule-null-source"');
});

test("TripwireNode content roles keep the title, compact reference and unset field summary", () => {
	const html = renderNode("tripwire");
	expect(html).toContain(
		'data-type-role="label" data-layout-role="workflow-node-title"',
	);
	expect(html).toContain(
		'data-type-role="code-text" data-layout-role="workflow-node-detail"',
	);
	expect(html).toContain("account-age@1");
	expect(html).toContain('data-layout-role="workflow-node-field-action"');
	expect(html).toContain('aria-label="Edit minimum account age"');
	expect(html).toContain('data-unset="true"');
	expect(html).toContain('data-layout-role="workflow-node-corner-output"');
});

test("TripwireNode message summaries preserve literal multiline text without a redundant label", () => {
	const message = "Review <b>this</b>\nمرحبا بالعالم";
	const html = renderNode("tripwire", GROUPS, {
		id: "rule",
		type: "action",
		action: "post-comment",
		params: { message },
	});
	expect(html).toContain('data-message="true"');
	expect(html).toContain("Review &lt;b&gt;this&lt;/b&gt;\nمرحبا بالعالم");
	expect(html).not.toContain('data-layout-role="workflow-node-field-label"');
	expect(html).not.toContain('data-unset="true"');
});

test("TripwireNode list summaries preserve item boundaries and edit targets", () => {
	const html = renderNode("tripwire", GROUPS, {
		id: "rule",
		type: "action",
		action: "label",
		params: { labels: ["needs review", "ready"] },
	});
	expect(html).toContain('aria-label="Edit Adds"');
	expect(html).toContain(
		'data-layout-role="workflow-node-field-item">needs review,</span> ',
	);
	expect(html).toContain(
		'data-layout-role="workflow-node-field-item">ready</span>',
	);
	expect(html).not.toContain('data-message="true"');
});

test("RuleGroupNode uses the same frame and retains its fail output and read-only controls", () => {
	const html = renderNode("ruleGroup");
	expect(html).toContain('data-layout-role="workflow-node-frame"');
	expect(html).toContain('data-problem-status="fail"');
	expect(html).toContain('data-selected="true"');
	expect(html).toContain('data-id="1-rule-fail-source"');
	expect(html).toContain('data-id="1-rule-null-target"');
	expect(html).toContain("Add rule");
	expect(html).toContain("Skip when");
	const readOnly = renderNode("ruleGroup", { ...GROUPS, readOnly: true });
	expect(readOnly).not.toContain("Add rule");
	expect(readOnly).not.toContain("Skip when");
});

test("SkipWhenNode keeps its pass output and permission-gated removal", () => {
	const groups: RuleGroupsApi = {
		...GROUPS,
		view: {
			...GROUPS.view,
			cards: new Map([
				[
					"rule",
					{
						kind: "skip",
						id: "rule",
						mode: "all-of",
						checkIds: ["member"],
						gateId: null,
						unlessId: "unless",
						groupId: "group",
					},
				],
			]),
		},
	};
	const html = renderNode("skipWhen", groups);
	expect(html).toContain('data-layout-role="workflow-node-frame"');
	expect(html).toContain('data-problem-status="fail"');
	expect(html).toContain('data-id="1-rule-null-source"');
	expect(html).toContain('data-id="1-rule-null-target"');
	expect(html).toContain('aria-label="Remove Skip when"');
	expect(html).toContain("Add check");
	const readOnly = renderNode("skipWhen", { ...groups, readOnly: true });
	expect(readOnly).not.toContain('aria-label="Remove Skip when"');
	expect(readOnly).not.toContain("Add check");
});
