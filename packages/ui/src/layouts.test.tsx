import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	ActionRow,
	Page,
	PageBody,
	PageHeader,
	Section,
	SectionBody,
	SectionHeader,
} from "./layouts";

describe("semantic layout molecules", () => {
	test("owns page hierarchy and action placement", () => {
		const markup = renderToStaticMarkup(
			<Page>
				<PageHeader
					actions={<button type="button">Invite</button>}
					description="Manage access to this organization."
					title="Members"
				/>
				<PageBody>Content</PageBody>
			</Page>,
		);
		expect(markup).toContain('<h1 data-type-role="page-title">Members</h1>');
		expect(markup).toContain('data-type-role="supporting-text"');
		expect(markup.indexOf("Members")).toBeLessThan(markup.indexOf("Invite"));
		expect(markup.indexOf("Invite")).toBeLessThan(markup.indexOf("Content"));
	});

	test("marks task pages without exposing geometry controls", () => {
		const markup = renderToStaticMarkup(<Page purpose="task">Queue</Page>);
		expect(markup).toContain('data-layout-purpose="task"');
		expect(markup).toContain('data-layout-role="page"');
	});

	test("binds a section heading to its region", () => {
		const markup = renderToStaticMarkup(
			<Section id="active-members">
				<SectionHeader title="Active members" />
				<SectionBody>Rows</SectionBody>
			</Section>,
		);
		expect(markup).toContain(
			'<section aria-labelledby="active-members-heading"',
		);
		expect(markup).toContain('data-type-role="section-heading"');
		expect(markup).toContain('id="active-members-heading">Active members</h2>');
	});

	test("keeps the primary action last in reading order", () => {
		const markup = renderToStaticMarkup(
			<ActionRow
				primary={<button type="submit">Save</button>}
				secondary={<button type="button">Cancel</button>}
			/>,
		);
		expect(markup.indexOf("Cancel")).toBeLessThan(markup.indexOf("Save"));
	});
});
