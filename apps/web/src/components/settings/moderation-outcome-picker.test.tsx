import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ModerationOutcomePicker } from "#/components/settings/moderation-outcome-picker";

test("the picker exposes the four approved outcomes through a labeled native select", () => {
	const html = renderToStaticMarkup(
		<ModerationOutcomePicker
			disabled={false}
			label="Pull requests"
			onChange={() => undefined}
			value="block"
		/>,
	);
	for (const [value, label] of [
		["warn", "Warn"],
		["human-review", "Human review"],
		["block", "Block"],
		["close", "Close"],
	]) {
		expect(html).toContain(`value="${value}"`);
		expect(html).toContain(label);
	}
	expect(html).toContain('value="block" selected=""');
	expect(html).toContain("<select");
	expect(html).toContain("Pull requests");
	expect(html).not.toContain(' disabled=""');
});

test("Pilot's default and explicit inheritance stay distinct in the picker", () => {
	const html = renderToStaticMarkup(
		<ModerationOutcomePicker
			defaultLabel="Pilot default (Human review)"
			disabled
			inheritLabel="Repo default (Block)"
			label="Pull requests"
			onChange={() => undefined}
			value="inherit"
		/>,
	);
	expect(html).toContain('value="default"');
	expect(html).toContain("Pilot default (Human review)");
	expect(html).toContain('value="inherit" selected=""');
	expect(html).toContain("Repo default (Block)");
	expect(html).toContain(' disabled=""');
});
