import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MetaRow } from "#/components/common/meta-row";

function classOf(markup: string): string {
	return /class="([^"]*)"/.exec(markup)?.[1] ?? "";
}

describe("MetaRow", () => {
	test("by default the last item truncates", () => {
		const classes = classOf(
			renderToStaticMarkup(
				<MetaRow>
					<span>a</span>
					<span>b</span>
				</MetaRow>,
			),
		);
		expect(classes).toContain("*:last:truncate");
	});

	test("a wrapping row never truncates its last item to make room", () => {
		const classes = classOf(
			renderToStaticMarkup(
				<MetaRow wrap>
					<span>octocat</span>
					<span>tripwire-demo/active-webapp</span>
					<time>6:45 AM PDT</time>
				</MetaRow>,
			),
		);
		expect(classes).toContain("flex-wrap");
		expect(classes).not.toContain("*:last:truncate");
		expect(classes).not.toContain("*:last:shrink");
	});
});
