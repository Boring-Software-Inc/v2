import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CommentMarkdown } from "#/components/responses/github-comment-mock";

test("comment markdown renders emphasis alongside bold and links", () => {
	const html = renderToStaticMarkup(
		<CommentMarkdown body="_quiet_ and **strong** with [context](https://example.com)" />,
	);

	expect(html).toContain("<em>quiet</em>");
	expect(html).toContain('<strong class="font-semibold">strong</strong>');
	expect(html).toContain("context");
	expect(html).not.toContain("_quiet_");
});
