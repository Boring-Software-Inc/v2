import { expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Forge, RepoReviewer } from "@tripwire/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import {
	ReviewerPicker,
	type ReviewerPickerProps,
	ReviewerScopeContext,
} from "#/components/workflows/editor/reviewer-picker";
import { repoReviewersQueryOptions } from "#/lib/reviewers.query";

function render(
	forge: Forge,
	reviewers: RepoReviewer[],
	chosen: ReviewerPickerProps["node"]["params"] = {},
	readOnly = false,
) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const scope = { org: "reviewer-test", repoId: "repo-test", forge };
	client.setQueryData(
		repoReviewersQueryOptions(scope.org, scope.repoId).queryKey,
		{ reviewers, syncedAt: new Date().toISOString(), syncing: false },
	);
	return renderToStaticMarkup(
		<QueryClientProvider client={client}>
			<ReviewerScopeContext.Provider value={scope}>
				<ReviewerPicker
					node={{
						id: "review",
						type: "action",
						action: "request-review",
						params: chosen,
					}}
					readOnly={readOnly}
					onUpdate={() => undefined}
				/>
			</ReviewerScopeContext.Provider>
		</QueryClientProvider>,
	);
}

test("a renamed GitCafe reviewer stays selected by stable string identity", () => {
	const html = render(
		"gitcafe",
		[
			{
				id: "act_stable",
				login: "current_handle",
				avatarUrl: "",
				permission: "review-candidate",
			},
		],
		{ reviewers: [{ id: "act_stable", login: "old_handle" }] },
	);
	expect(html).toContain("current_handle");
	expect(html).not.toContain("can no longer review this repo");
	expect(html).toContain("Suggestions come from open pull requests");
});

test("an empty GitCafe list explains how to load reviewers without changing GitHub copy", () => {
	expect(render("gitcafe", [])).toContain(
		"Open a pull request on GitCafe, then refresh",
	);
	const github = render("github", []);
	expect(github).toContain("No reviewers found");
	expect(github).not.toContain("Open a pull request on GitCafe");
});

test("missing GitCafe suggestions do not assert that saved actors lost access", () => {
	const html = render("gitcafe", [], {
		reviewers: [{ id: "act_stable", login: "saved_person" }],
	});
	expect(html).toContain("saved_person");
	expect(html).toContain("Suggestions come from open pull requests");
	expect(html).not.toContain("can no longer review");
});

test("read-only reviewer selection keeps its disabled refresh control", () => {
	const html = render("gitcafe", [], {}, true);
	expect(html).toContain("disabled");
	expect(html).toContain("Refresh");
});
