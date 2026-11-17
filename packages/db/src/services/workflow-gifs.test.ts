import { describe, expect, test } from "bun:test";
import type { CloseGif, WorkflowDefinition } from "@tripwire/contracts";
import { settleWorkflowGifsWith } from "./workflow-gifs.ts";

const canonical: CloseGif = {
	id: "abc123",
	url: "https://media2.giphy.com/media/abc123/canonical.gif",
	width: 480,
	height: 270,
	title: "Canonical",
};

function definition(gif: CloseGif): WorkflowDefinition {
	return {
		id: "workflow",
		name: "Comment",
		version: 1,
		nodes: [
			{
				id: "trigger",
				type: "trigger",
				kinds: ["change-request.opened"],
			},
			{
				id: "comment",
				type: "action",
				action: "post-comment",
				params: { message: "Ship it", gif },
			},
		],
		edges: [{ id: "edge", from: "trigger", to: "comment" }],
	};
}

function settledGif(result: WorkflowDefinition): CloseGif | null | undefined {
	const node = result.nodes.find((candidate) => candidate.id === "comment");
	if (node?.type !== "action") {
		throw new Error("comment action missing");
	}
	return node.params?.gif as CloseGif | null | undefined;
}

describe("workflow GIF provenance", () => {
	test("replaces submitted allowed-host metadata with the cached GIF", async () => {
		const tampered = {
			...canonical,
			url: "https://media9.giphy.com/media/other/tampered.gif",
			width: 1,
			height: 1,
			title: "Tampered",
		};
		const result = await settleWorkflowGifsWith(
			definition(tampered),
			async () => Promise.resolve(canonical),
		);
		expect(settledGif(result)).toEqual(canonical);
	});

	test("drops a GIF id that is no longer in the served cache", async () => {
		const result = await settleWorkflowGifsWith(
			definition(canonical),
			async () => Promise.resolve(null),
		);
		expect(settledGif(result)).toBeNull();
	});
});
