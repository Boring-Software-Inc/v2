import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { DiffStats } from "#/components/code/code-header";
import { PierreDiff } from "#/components/code/pierre-code";
import {
	loadPierreCode,
	loadPierreFileComponent,
} from "#/components/code/pierre-code-loader";
import {
	WorkflowCode,
	WorkflowCodeSnapshot,
	workflowCodeRenderSnapshot,
} from "#/components/workflows/editor/workflow-code";

const code = "export const workflow = {};";
const saved = "export const workflow = { enabled: false };";

test("workflow code selects a diff only for an unsaved view with saved code", () => {
	for (const unsaved of [false, true]) {
		for (const before of [null, saved]) {
			const html = renderToStaticMarkup(
				<WorkflowCode
					unsaved={unsaved}
					view={{ kind: "code", code, saved: before, warnings: [], unsaved }}
				/>,
			);
			const slot = unsaved && before !== null ? "diff" : "file";
			expect(html).toContain(`data-slot="tripwire-code-${slot}"`);
			expect(html).toContain("tripwire.ts");
			expect(html).toContain('data-slot="tripwire-code-loading"');
			expect(html).not.toContain('data-slot="plain-code"');
			expect(html).not.toContain('data-layout-role="workflow-code-warnings"');
		}
	}
});

test("workflow code warnings and refusal preserve escaped draft content", () => {
	const hostile = "<b>unfinished</b> مرحبا";
	const html = renderToStaticMarkup(
		<WorkflowCode
			unsaved
			view={{ kind: "code", code, saved, warnings: [hostile], unsaved: true }}
		/>,
	);
	expect(html).toContain('data-layout-role="workflow-code-warnings"');
	expect(html).toContain("&lt;b&gt;unfinished&lt;/b&gt; مرحبا");
	const refused = renderToStaticMarkup(
		<WorkflowCode unsaved view={{ kind: "refused", reason: hostile }} />,
	);
	expect(refused).toContain("This workflow cannot be written as code");
	expect(refused).toContain("&lt;b&gt;unfinished&lt;/b&gt; مرحبا");
	expect(refused).not.toContain('data-slot="tripwire-code-file"');
	expect(refused).not.toContain('data-slot="tripwire-code-diff"');
});

test("pending recomputes retain one coherent visible and copyable snapshot", () => {
	const previous = {
		unsaved: false,
		view: {
			kind: "code" as const,
			code: "export const previous = true;",
			saved: null,
			warnings: ["previous warning"],
			unsaved: false,
		},
	};
	const current = {
		unsaved: true,
		view: {
			kind: "code" as const,
			code: "export const current = true;",
			saved: "export const previous = true;",
			warnings: ["current warning"],
			unsaved: true,
		},
	};

	const pending = workflowCodeRenderSnapshot(current, previous);
	expect(pending).toMatchObject({
		pending: true,
		unsaved: false,
		view: {
			code: "export const previous = true;",
			saved: null,
			warnings: ["previous warning"],
		},
	});
	const pendingHtml = renderToStaticMarkup(
		<WorkflowCodeSnapshot snapshot={pending} />,
	);
	expect(pendingHtml).toContain('data-update-pending=""');
	expect(pendingHtml).toContain("Updating code preview");
	expect(pendingHtml).toContain("previous warning");
	expect(pendingHtml).toContain('data-slot="tripwire-code-file"');

	const settled = workflowCodeRenderSnapshot(current, current);
	expect(settled).toMatchObject({
		pending: false,
		unsaved: true,
		view: {
			code: "export const current = true;",
			saved: "export const previous = true;",
			warnings: ["current warning"],
		},
	});
	const settledHtml = renderToStaticMarkup(
		<WorkflowCodeSnapshot snapshot={settled} />,
	);
	expect(settledHtml).not.toContain('data-update-pending=""');
	expect(settledHtml).not.toContain("Updating code preview");
	expect(settledHtml).toContain("current warning");
	expect(settledHtml).toContain('data-slot="tripwire-code-diff"');
	let stats: DiffStats | undefined;
	renderToStaticMarkup(
		<PierreDiff
			after={current.view.code}
			before={current.view.saved}
			contentId="test-diff"
			dark={false}
			hidden={false}
			name="tripwire.ts"
			renderHeader={(next) => {
				stats = next;
				return null;
			}}
			split={false}
			wrap={false}
		/>,
	);
	expect(stats).toEqual({ added: 1, removed: 1 });
});

test("the formatter and renderer share one readiness transition", async () => {
	const first = loadPierreCode();
	const second = loadPierreCode();

	expect(first).toBe(second);
	const module = await first;
	expect(module.PierreFile).toBeFunction();
	expect(module.PierreDiff).toBeFunction();
});

test("a formatter load failure keeps a stable explicit error surface", async () => {
	const { default: FailedFile } = await loadPierreFileComponent(() =>
		Promise.reject(new Error("chunk unavailable")),
	);
	const html = renderToStaticMarkup(
		<FailedFile
			code={code}
			dark={false}
			name="tripwire.ts"
			selected={null}
			wrap={false}
		/>,
	);

	expect(html).toContain('data-slot="tripwire-code-error"');
	expect(html).toContain("Code preview unavailable");
	expect(html).not.toContain(code);
});
