import { describe, expect, test } from "bun:test";
import {
	matchWorkflowIds,
	workflowKeys,
	workflowSlug,
} from "./workflow-keys.ts";

describe("a workflow's key in tripwire.ts", () => {
	test.each([
		["Block crypto pushes", "block-crypto-pushes"],
		["trigger: Push", "trigger-push"],
		["  New   accounts!! ", "new-accounts"],
		["Café déjà vu", "cafe-deja-vu"],
		["PR rate-limit (5/24h)", "pr-rate-limit-5-24h"],
		["", "workflow"],
		["!!!", "workflow"],
		["日本語", "workflow"],
	])("%j is %j", (name, slug) => {
		expect(workflowSlug(name)).toBe(slug);
	});

	test("a long name is cut at a word, never mid word", () => {
		const slug = workflowSlug(
			"Close stale issues that nobody has touched in a very long time at all",
		);
		expect(slug.length).toBeLessThanOrEqual(48);
		expect(slug).toBe("close-stale-issues-that-nobody-has-touched-in-a");
	});

	test("two workflows with one name get distinct keys, in order", () => {
		const keys = workflowKeys([
			{ id: "a", name: "Block crypto" },
			{ id: "b", name: "Block crypto" },
			{ id: "c", name: "Block crypto" },
		]);
		expect([...keys]).toEqual([
			["a", "block-crypto"],
			["b", "block-crypto-2"],
			["c", "block-crypto-3"],
		]);
	});

	test("a kept key survives a rename and is never reused", () => {
		const keys = workflowKeys(
			[
				{ id: "a", name: "Renamed" },
				{ id: "b", name: "Old name" },
			],
			new Map([["a", "old-name"]]),
		);
		expect(keys.get("a")).toBe("old-name");
		expect(keys.get("b")).toBe("old-name-2");
	});

	test("a kept key that two ids claim goes to the first", () => {
		const keys = workflowKeys(
			[
				{ id: "a", name: "A" },
				{ id: "b", name: "B" },
			],
			new Map([
				["a", "shared"],
				["b", "shared"],
			]),
		);
		expect(keys.get("a")).toBe("shared");
		expect(keys.get("b")).toBe("b");
	});
});

describe("matching keys in a file to server workflows", () => {
	const server = [
		{ id: "01-uuid-a", name: "Block crypto pushes" },
		{ id: "new-accounts", name: "New accounts" },
		{ id: "01-uuid-c", name: "Stale issues" },
	];
	const def = (id: string, name: string) => ({
		id,
		name,
		version: 1,
		nodes: [{ id: "t", type: "trigger" as const, kinds: ["push" as const] }],
		edges: [],
	});

	test("the project mapping wins", () => {
		const { definitions, matches } = matchWorkflowIds(
			[def("crypto", "Renamed")],
			server,
			{ crypto: "01-uuid-a" },
		);
		expect(definitions[0]?.id).toBe("01-uuid-a");
		expect(matches).toEqual([
			{ key: "crypto", id: "01-uuid-a", by: "mapping" },
		]);
	});

	test("a key that is a server id is that workflow", () => {
		const { matches } = matchWorkflowIds([def("new-accounts", "x")], server);
		expect(matches).toEqual([
			{ key: "new-accounts", id: "new-accounts", by: "id" },
		]);
	});

	test("with no mapping a key matches the server workflow with that slug", () => {
		const { definitions, matches } = matchWorkflowIds(
			[def("block-crypto-pushes", "Block crypto pushes")],
			server,
			{},
		);
		expect(definitions[0]?.id).toBe("01-uuid-a");
		expect(matches[0]).toEqual({
			key: "block-crypto-pushes",
			id: "01-uuid-a",
			by: "name",
		});
	});

	test("a server workflow is matched once, by the strongest claim", () => {
		const { matches } = matchWorkflowIds(
			[def("block-crypto-pushes", "Block crypto pushes"), def("mine", "Mine")],
			server,
			{ mine: "01-uuid-a" },
		);
		expect(matches).toEqual([
			{ key: "block-crypto-pushes", id: "block-crypto-pushes", by: "new" },
			{ key: "mine", id: "01-uuid-a", by: "mapping" },
		]);
	});

	test("anything else is a new workflow with its key as id", () => {
		const { definitions, matches } = matchWorkflowIds(
			[def("brand-new", "Brand new")],
			server,
		);
		expect(definitions[0]?.id).toBe("brand-new");
		expect(matches).toEqual([{ key: "brand-new", id: "brand-new", by: "new" }]);
	});
});
