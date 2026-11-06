import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleGroup,
	CollapsibleTrigger,
} from "#/components/glaze/ui/collapsible";

describe("collapsible trigger alignment", () => {
	test("centers an icon-bearing label and its summary without using the icon baseline", () => {
		const markup = renderToStaticMarkup(
			<CollapsibleGroup>
				<Collapsible value="github">
					<CollapsibleTrigger summary="6 repos">
						<span className="inline-flex items-center gap-2">
							<svg aria-hidden="true" viewBox="0 0 16 16" />
							GitHub
						</span>
					</CollapsibleTrigger>
					<CollapsibleContent>Repositories</CollapsibleContent>
				</Collapsible>
			</CollapsibleGroup>,
		);

		expect(markup).toContain('data-slot="collapsible-label-row"');
		expect(markup).toContain(
			'class="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5"',
		);
		expect(markup).toContain(
			'data-slot="collapsible-label" class="flex min-w-0 items-center"',
		);
		expect(markup).not.toContain(
			"flex min-w-0 flex-1 flex-wrap items-baseline",
		);
	});
});
