import { describe, expect, test } from "bun:test";
import { runButton } from "@tripwire/contracts";
import {
	loadGitCafeRunBadge,
	needsGitCafeRunBadge,
	renderGitCafeRunBadge,
} from "./run-button.ts";

const RUN_URL = "https://staging.tripwire.sh/runs/01a200de";
const ATTACHMENT_URL =
	"/api/repos/boring/scratch/attachments/attach_01m80dwekjezc9asafppafrc10";

describe("GitCafe run button", () => {
	test("rewrites the shared HTML button as a linked GitCafe attachment", () => {
		const body = `Tripwire blocked this change request.\n\n${runButton(RUN_URL)}`;

		expect(needsGitCafeRunBadge(body)).toBe(true);
		expect(renderGitCafeRunBadge(body, ATTACHMENT_URL)).toBe(
			`Tripwire blocked this change request.\n\n[![View on Tripwire](${ATTACHMENT_URL})](${RUN_URL})`,
		);
	});

	test("does not rewrite unrelated HTML or an unsafe run link", () => {
		const unrelated = '<a href="https://example.com">View on Tripwire</a>';
		const unsafe = runButton("javascript:alert(1)");

		expect(needsGitCafeRunBadge(unrelated)).toBe(false);
		expect(renderGitCafeRunBadge(unrelated, ATTACHMENT_URL)).toBe(unrelated);
		expect(renderGitCafeRunBadge(unsafe, ATTACHMENT_URL)).toBe(unsafe);
	});

	test("ships the same non-empty badge asset as the web app", async () => {
		const loaded = await loadGitCafeRunBadge();

		expect(loaded.bytes.byteLength).toBe(28_953);
		expect(loaded.sha256).toBe(
			"c16b7ff356bf4fe6ebb45abbd43e146e0c5a5c4d3e66225e60e2c247b38379b2",
		);
	});
});
