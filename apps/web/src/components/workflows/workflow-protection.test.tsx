import { describe, expect, test } from "bun:test";
import { FlagsProvider } from "@databuddy/sdk/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { DEFAULT_WORKFLOW, type Forge } from "@tripwire/contracts";
import { renderToString } from "react-dom/server";
import { RepoTabsProvider } from "#/components/tabs/repo-tabs-provider";
import { EditorHeader } from "#/components/workflows/editor/editor-header";
import { WorkflowEditorPage } from "#/components/workflows/editor/workflow-editor-page";
import { WorkflowsGridPage } from "#/components/workflows/workflows-grid-page";
import { GlazePortalProvider } from "#/lib/glaze/portal";
import { orgContextQueryOptions, orgRepoQueryOptions } from "#/lib/org.query";
import { ruleConfigsQueryOptions } from "#/lib/rules.query";
import { workflowEditorSearchSchema } from "#/lib/workflow-editor-search";
import type { WorkflowDetail } from "#/lib/workflows.functions";
import {
	workflowDetailQueryOptions,
	workflowsListQueryOptions,
} from "#/lib/workflows.query";

/** Synthetic application state tests UI capabilities, not provider responses. */
async function renderWorkflowPage({
	forge,
	canManage,
	enabled,
	editor,
}: {
	forge: Forge;
	canManage: boolean;
	enabled: boolean;
	editor: boolean;
}) {
	const client = new QueryClient();
	client.setQueryData(orgContextQueryOptions("team").queryKey, {
		id: "org-team",
		slug: "team",
		name: "Team",
		role: canManage ? "workflow-manager" : "member",
		isPersonal: false,
		avatarHue: null,
		timezone: null,
		permissions: canManage
			? ["workflows:read", "workflows:manage"]
			: ["workflows:read"],
	});
	client.setQueryData(orgRepoQueryOptions("team", "scratch").queryKey, {
		id: "repo-team",
		forge,
		owner: "team",
		name: "scratch",
		fullName: "team/scratch",
		private: false,
		armed: false,
		backfillTotal: null,
		backfillDone: null,
	});
	const workflow: WorkflowDetail = {
		id: "workflow-test",
		name: "Check contributions",
		enabled,
		nodeCount: DEFAULT_WORKFLOW.nodes.length,
		triggerKinds: ["change-request.opened"],
		schedules: [],
		updatedAt: "2026-10-28T12:00:00.000Z",
		runnable: true,
		canTurnOn: true,
		state: enabled ? "on" : "off",
		draftId: null,
		work: null,
		definition: DEFAULT_WORKFLOW,
		lastTicks: {},
	};
	client.setQueryData(workflowsListQueryOptions("team", "repo-team").queryKey, [
		workflow,
	]);
	client.setQueryData(
		workflowDetailQueryOptions("team", "repo-team", workflow.id).queryKey,
		workflow,
	);
	client.setQueryData(
		ruleConfigsQueryOptions("team", "repo-team").queryKey,
		[],
	);
	const root = createRootRoute({
		component: () => (
			<QueryClientProvider client={client}>
				<FlagsProvider clientId="synthetic">
					<RepoTabsProvider>
						<GlazePortalProvider>
							<Outlet />
						</GlazePortalProvider>
					</RepoTabsProvider>
				</FlagsProvider>
			</QueryClientProvider>
		),
	});
	const grid = createRoute({
		getParentRoute: () => root,
		path: "$org/$repo/workflows/",
		component: WorkflowsGridPage,
	});
	const detail = createRoute({
		getParentRoute: () => root,
		path: "$org/$repo/workflows/$workflowId",
		component: WorkflowEditorPage,
		validateSearch: workflowEditorSearchSchema,
	});
	const router = createRouter({
		isServer: true,
		origin: "https://tripwire.test",
		routeTree: root.addChildren([grid, detail]),
		history: createMemoryHistory({
			initialEntries: [
				editor
					? "/team/scratch/workflows/workflow-test?view=canvas"
					: "/team/scratch/workflows",
			],
		}),
	});
	await router.load();
	expect(router.state.matches.map((match) => match.routeId)).toEqual([
		"__root__",
		editor ? "/$org/$repo/workflows/$workflowId" : "/$org/$repo/workflows/",
	]);
	for (const match of router.state.matches) {
		if (match.error) throw match.error;
	}
	const html = renderToString(<RouterProvider router={router} />).replaceAll(
		"<!-- -->",
		"",
	);
	client.clear();
	return html;
}

function control(html: string, label: string) {
	const elements = label.startsWith("Run ")
		? html.match(/<[^>]*role="switch"[^>]*>/g)
		: html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g);
	const found = elements?.find((element) => element.includes(label));
	expect(found).toBeDefined();
	return found ?? "";
}

describe("workflow activation follows the loaded repository capability", () => {
	test("an edited off GitCafe workflow can still be saved in canvas and code views", async () => {
		for (const view of ["canvas", "code"] as const) {
			const root = createRootRoute({
				component: () => (
					<EditorHeader
						forge="gitcafe"
						org="team"
						repo="scratch"
						name="Check contributions"
						definition={DEFAULT_WORKFLOW}
						customRules={[]}
						enabled={false}
						readOnly={false}
						dirty={true}
						saving={false}
						toggling={false}
						zeroNodes={false}
						blockers={[]}
						view={view}
						onViewChange={() => undefined}
						onSave={() => undefined}
						onArrange={() => undefined}
						onShowProblems={() => undefined}
						onRename={async () => ({ ok: true })}
						onSetEnabled={() => undefined}
					/>
				),
			});
			const home = createRoute({ getParentRoute: () => root, path: "/" });
			const router = createRouter({
				isServer: true,
				origin: "https://tripwire.test",
				routeTree: root.addChildren([home]),
				history: createMemoryHistory({ initialEntries: ["/"] }),
			});
			await router.load();
			const html = renderToString(<RouterProvider router={router} />);
			expect(control(html, "Save workflow")).not.toContain('disabled=""');
			expect(control(html, "Turn on workflow")).not.toContain('disabled=""');
			expect(html).toContain('aria-label="Rename Check contributions"');
		}
	});

	for (const editor of [false, true]) {
		for (const forge of ["github", "gitcafe"] as const) {
			for (const canManage of [false, true]) {
				for (const enabled of [false, true]) {
					test(`${editor ? "editor" : "grid"}: ${forge}, ${canManage ? "workflow manager" : "reader"}, ${enabled ? "on" : "off"}`, async () => {
						const html = await renderWorkflowPage({
							forge,
							canManage,
							enabled,
							editor,
						});
						const blocked = !canManage;
						if (editor && !canManage) {
							expect(html).toContain("Read only");
							expect(html).not.toContain("Turn on workflow");
							expect(html).not.toContain("Turn off workflow");
						} else {
							const toggle = control(
								html,
								editor
									? enabled
										? "Turn off workflow"
										: "Turn on workflow"
									: "Run Check contributions on change requests",
							);
							expect(/(?:aria-)?disabled="(?:true)?"/.test(toggle)).toBe(
								blocked,
							);
						}
						expect(html).not.toContain("protection is unavailable");
						if (editor && canManage) {
							expect(html).toContain('aria-label="Rename Check contributions"');
							expect(html).toContain("Save workflow");
							expect(html).not.toContain("Read only");
						}
					});
				}
			}
		}
	}
});
