import { describe, expect, test } from "bun:test";
import type { z } from "zod";
import {
	type CommentInput,
	type CommentReason,
	closeGifMarkdown,
	planSurfaces,
	renderVerdictComment,
} from "./comment-render.ts";
import { OPEN_REDACTION, redactionPolicySchema } from "./redaction.ts";
import {
	commentOverrideFor,
	DEFAULT_RESPONSE_CONFIG,
	isGiphyMediaUrl,
	type ResponseConfig,
	responseConfigSchema,
	wantsComment,
} from "./response.ts";

type ResponseConfigInput = z.input<typeof responseConfigSchema>;

const RUN_URL = "https://tripwire.sh/runs/0198abcd";
const GIF = {
	id: "l0MYt5jPR6QX5pnqM",
	url: "https://media2.giphy.com/media/l0MYt5jPR6QX5pnqM/200.gif",
	width: 356,
	height: 200,
	title: "Bye Bye GIF",
};
const AGE: CommentReason = {
	text: "Your account is 2 days old.",
	remedy: "wait",
	ruleId: "account-age",
	ruleName: "Account age",
};

function config(extra: ResponseConfigInput = {}): ResponseConfig {
	return responseConfigSchema.parse(extra);
}

function input(verdict: CommentInput["verdict"]): CommentInput {
	return {
		verdict,
		contributorLogin: "octocat",
		reasons: [AGE],
		runUrl: RUN_URL,
	};
}

describe("close gif config", () => {
	test("no gif by default, close comments on by default", () => {
		expect(DEFAULT_RESPONSE_CONFIG.closeComment.gif).toBeNull();
		expect(DEFAULT_RESPONSE_CONFIG.onClose).toBe("comment");
		expect(wantsComment(DEFAULT_RESPONSE_CONFIG, "close")).toBe(true);
	});

	test("a stored gif round trips", () => {
		const parsed = config({ closeComment: { gif: GIF } });
		expect(parsed.closeComment.gif).toEqual(GIF);
	});

	test("a gif off GIPHY's media hosts is dropped, the rest of the config survives", () => {
		const parsed = config({
			onBlock: "silent",
			closeComment: {
				customText: "Bye.",
				gif: { ...GIF, url: "https://evil.example/200.gif" },
			},
		});
		expect(parsed.closeComment.gif).toBeNull();
		expect(parsed.closeComment.customText).toBe("Bye.");
		expect(parsed.onBlock).toBe("silent");
	});

	test("media hosts", () => {
		expect(isGiphyMediaUrl(GIF.url)).toBe(true);
		expect(isGiphyMediaUrl("https://media.giphy.com/media/x/200.gif")).toBe(
			true,
		);
		expect(isGiphyMediaUrl("https://i.giphy.com/x.gif")).toBe(true);
		expect(isGiphyMediaUrl("http://media.giphy.com/media/x/200.gif")).toBe(
			false,
		);
		expect(isGiphyMediaUrl("https://giphy.com.evil.example/x.gif")).toBe(false);
		expect(isGiphyMediaUrl("https://api.giphy.com/v1/gifs/x")).toBe(false);
		expect(isGiphyMediaUrl("not a url")).toBe(false);
	});

	test("close has its own switches, block keeps its own", () => {
		const off = config({ onClose: "silent" });
		expect(wantsComment(off, "close")).toBe(false);
		expect(wantsComment(off, "block")).toBe(true);
		const linkOff = config({ closeComment: { showDetailsButton: false } });
		expect(commentOverrideFor(linkOff, "close").showDetailsButton).toBe(false);
		expect(commentOverrideFor(linkOff, "block").showDetailsButton).toBe(true);
	});
});

describe("close comment rendering", () => {
	test("the gif is a markdown image at the end of the close comment", () => {
		const body = renderVerdictComment(
			input("close"),
			config({ closeComment: { gif: GIF } }),
		);
		const parts = body.trim().split("\n\n");
		expect(parts[0]).toBe("Closed.");
		expect(body).toContain("Your account is 2 days old.");
		expect(parts.at(-2)).toBe(`![Bye Bye GIF](${GIF.url})`);
	});

	test("no gif: the close comment has no image", () => {
		const body = renderVerdictComment(input("close"), config());
		expect(body).not.toContain("![");
	});

	test("only close carries the gif", () => {
		const withGif = config({ closeComment: { gif: GIF } });
		for (const verdict of [
			"block",
			"pass",
			"needs_review",
			"changes_required",
		] as const) {
			expect(renderVerdictComment(input(verdict), withGif)).not.toContain(
				GIF.url,
			);
		}
	});

	test("custom close text still carries the gif", () => {
		const body = renderVerdictComment(
			input("close"),
			config({ closeComment: { customText: "Closing this.", gif: GIF } }),
		);
		expect(body).toContain("Closing this.");
		expect(body).toContain(`![Bye Bye GIF](${GIF.url})`);
	});

	test("redaction hides reasons, never the gif", () => {
		const policy = redactionPolicySchema.parse({ level: 8 });
		const body = renderVerdictComment(
			input("close"),
			config({ closeComment: { gif: GIF } }),
			policy,
		);
		expect(body).not.toContain("2 days old");
		expect(body).toContain(`![Bye Bye GIF](${GIF.url})`);
	});

	test("block's one line mode does not shape the close comment", () => {
		const body = renderVerdictComment(
			input("close"),
			config({ blockComment: { mode: "one-liner-link" } }),
		);
		expect(body).toContain("Your account is 2 days old.");
	});

	test("titles cannot break out of the image alt text", () => {
		const markdown = closeGifMarkdown(
			config({
				closeComment: { gif: { ...GIF, title: "a](https://x.example)[b" } },
			}),
		);
		expect(markdown).toBe(`![a (https://x.example) b](${GIF.url})`);
		const blank = closeGifMarkdown(
			config({ closeComment: { gif: { ...GIF, title: "" } } }),
		);
		expect(blank).toBe(`![GIF](${GIF.url})`);
	});

	test("parentheses in the url are escaped", () => {
		const markdown = closeGifMarkdown(
			config({
				closeComment: {
					gif: {
						...GIF,
						url: "https://media.giphy.com/media/a(b)/200.gif",
					},
				},
			}),
		);
		expect(markdown).toBe(
			"![Bye Bye GIF](https://media.giphy.com/media/a%28b%29/200.gif)",
		);
	});

	test("close plans one comment and no review", () => {
		const plan = planSurfaces(
			input("close"),
			config({ closeComment: { gif: GIF } }),
			OPEN_REDACTION,
			{ reviewPosted: false },
		);
		expect(plan.comment).toBe("upsert");
		expect(plan.review).toBeNull();
		expect(plan.commentBody).toContain(GIF.url);
	});
});
