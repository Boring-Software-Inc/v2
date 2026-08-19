import { describe, expect, test } from "bun:test";
import {
	parseStoredRepoTabs,
	type RepoTab,
	repoTabForLocation,
	repoTabsReducer,
	resolveRepoTabPath,
} from "#/components/tabs/repo-tabs-state";

function tab(org: string, repo: string, path: string): RepoTab {
	return { id: `${org}/${repo}`, org, repo, path };
}

/** Walk a sequence of visited pages through the reducer, as route sync does. */
function visit(tabs: RepoTab[], ...visited: RepoTab[]): RepoTab[] {
	return visited.reduce(
		(state, next) => repoTabsReducer(state, { type: "open", tab: next }),
		tabs,
	);
}

describe("repo tabs — per-tab page memory", () => {
	test("switching repos leaves the other tab on the page you left it", () => {
		const tabs = visit(
			[],
			tab("tripwire", "v2", "/tripwire/v2/moderation"),
			tab("tripwire", "v2", "/tripwire/v2/rules"),
			tab("chair", "app", "/chair/app/moderation"),
			tab("chair", "app", "/chair/app/rules"),
		);

		expect(tabs.map((t) => t.path)).toEqual([
			"/tripwire/v2/rules",
			"/chair/app/rules",
		]);
	});

	test("navigating inside a repo moves only that repo's tab", () => {
		const opened = visit(
			[],
			tab("tripwire", "v2", "/tripwire/v2/rules"),
			tab("chair", "app", "/chair/app/moderation"),
		);
		const moved = visit(opened, tab("chair", "app", "/chair/app/analytics"));

		expect(moved[0]?.path).toBe("/tripwire/v2/rules");
		expect(moved[1]?.path).toBe("/chair/app/analytics");
	});

	test("revisiting a repo appends nothing — one tab per repo", () => {
		const tabs = visit(
			[],
			tab("tripwire", "v2", "/tripwire/v2/rules"),
			tab("chair", "app", "/chair/app/rules"),
			tab("tripwire", "v2", "/tripwire/v2/workflows"),
		);

		expect(tabs).toHaveLength(2);
		expect(tabs.map((t) => t.id)).toEqual(["tripwire/v2", "chair/app"]);
	});

	test("an unchanged page returns the same array — no needless re-render", () => {
		const opened = visit([], tab("tripwire", "v2", "/tripwire/v2/rules"));
		expect(
			repoTabsReducer(opened, {
				type: "open",
				tab: tab("tripwire", "v2", "/tripwire/v2/rules"),
			}),
		).toBe(opened);
	});

	test("closing drops only that tab", () => {
		const opened = visit(
			[],
			tab("tripwire", "v2", "/tripwire/v2/rules"),
			tab("chair", "app", "/chair/app/rules"),
		);
		expect(
			repoTabsReducer(opened, { type: "close", id: "tripwire/v2" }),
		).toEqual([tab("chair", "app", "/chair/app/rules")]);
	});
});

describe("repo tabs — closing", () => {
	/**
	 * The sequence that used to reorder the strip instead of closing: close the
	 * active tab, navigate to its neighbour, and let route sync run once against
	 * the half-committed router state (old match, new pathname) before the
	 * commit settles.
	 */
	test("closing the active tab does not re-open it mid-navigation", () => {
		const opened = visit(
			[],
			tab("yert", "tripwire", "/yert/tripwire/rules"),
			tab("yert", "v2", "/yert/v2/rules"),
		);

		const closed = repoTabsReducer(opened, {
			type: "close",
			id: "yert/tripwire",
		});

		// Mid-commit: matches still say `yert/tripwire`, location already says v2.
		const straddle = repoTabForLocation("yert", "tripwire", "/yert/v2/rules");
		expect(straddle).toBeNull();

		// Commit settles on the neighbour.
		const settled = visit(closed, tab("yert", "v2", "/yert/v2/rules"));
		expect(settled.map((t) => t.id)).toEqual(["yert/v2"]);
	});

	test("closing the last tab leaves nothing behind on the way to org home", () => {
		const opened = visit([], tab("yert", "v2", "/yert/v2/rules"));
		const closed = repoTabsReducer(opened, { type: "close", id: "yert/v2" });

		expect(repoTabForLocation("yert", "v2", "/yert/home")).toBeNull();
		expect(closed).toEqual([]);
	});
});

describe("repo tabs — path guards", () => {
	test("a path outside the repo falls back to the repo root", () => {
		expect(resolveRepoTabPath("tripwire", "v2", "/tripwire/home")).toBe(
			"/tripwire/v2",
		);
		expect(resolveRepoTabPath("tripwire", "v2", "/chair/app/rules")).toBe(
			"/tripwire/v2",
		);
		// A repo whose name merely prefixes another must not match.
		expect(resolveRepoTabPath("tripwire", "v2", "/tripwire/v22/rules")).toBe(
			"/tripwire/v2",
		);
	});

	test("pages inside the repo are kept verbatim", () => {
		expect(
			resolveRepoTabPath("tripwire", "v2", "/tripwire/v2/workflows/abc"),
		).toBe("/tripwire/v2/workflows/abc");
		expect(resolveRepoTabPath("tripwire", "v2", "/tripwire/v2")).toBe(
			"/tripwire/v2",
		);
	});
});

describe("repo tabs — stored state", () => {
	test("malformed entries are dropped, good ones survive", () => {
		const stored = JSON.stringify([
			{ org: "tripwire", repo: "v2", path: "/tripwire/v2/rules" },
			{ org: "chair" },
			null,
			"nope",
			{ org: "chair", repo: "app" },
		]);

		expect(parseStoredRepoTabs(stored)).toEqual([
			tab("tripwire", "v2", "/tripwire/v2/rules"),
			tab("chair", "app", "/chair/app"),
		]);
	});

	test("junk in storage yields an empty strip rather than throwing", () => {
		expect(parseStoredRepoTabs("{{")).toEqual([]);
		expect(parseStoredRepoTabs('{"tabs":[]}')).toEqual([]);
	});
});
