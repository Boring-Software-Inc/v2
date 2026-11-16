import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ScopeSwitcherTrigger } from "./scope-switchers";

describe("ScopeSwitcherTrigger", () => {
	test("reserves repo identity geometry while forge metadata resolves", () => {
		const markup = renderToStaticMarkup(
			<ScopeSwitcherTrigger appearance="rail" label="tripwire" reserveIcon />,
		);

		expect(markup).toContain('data-layout-role="scope-switcher-icon"');
		expect(markup).toContain('data-layout-role="scope-switcher-label"');
		expect(markup).toContain("tripwire");
	});
});
