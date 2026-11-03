import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	Body,
	Caption,
	CodeText,
	DataValue,
	Label,
	PageTitle,
	SectionHeading,
	Subheading,
	SupportingText,
} from "./typography";

describe("semantic typography", () => {
	test("renders the fixed page hierarchy roles", () => {
		const markup = renderToStaticMarkup(
			<>
				<PageTitle>Members</PageTitle>
				<SectionHeading>Invite links</SectionHeading>
				<Subheading>Expiration</Subheading>
			</>,
		);
		expect(markup).toContain('<h1 data-type-role="page-title">Members</h1>');
		expect(markup).toContain(
			'<h2 data-type-role="section-heading">Invite links</h2>',
		);
		expect(markup).toContain('<h3 data-type-role="subheading">Expiration</h3>');
	});

	test("allows only semantic element changes without visual variants", () => {
		const markup = renderToStaticMarkup(
			<>
				<SectionHeading level={3}>Nested section</SectionHeading>
				<Subheading level={4}>Nested detail</Subheading>
				<Body as="span">Body</Body>
				<SupportingText as="span">Supporting</SupportingText>
				<Label as="div">Label</Label>
			</>,
		);
		expect(markup).toContain('<h3 data-type-role="section-heading">');
		expect(markup).toContain('<h4 data-type-role="subheading">');
		expect(markup).toContain('<span data-type-role="body">Body</span>');
		expect(markup).toContain(
			'<span data-type-role="supporting-text">Supporting</span>',
		);
		expect(markup).toContain('<div data-type-role="label">Label</div>');
	});

	test("marks code, metadata, and changing data by semantics", () => {
		const markup = renderToStaticMarkup(
			<>
				<Caption>2 minutes ago</Caption>
				<CodeText>account-age@1</CodeText>
				<DataValue as="output">42</DataValue>
			</>,
		);
		expect(markup).toContain('data-type-role="caption"');
		expect(markup).toContain('data-type-role="code-text"');
		expect(markup).toContain('<output data-type-role="data-value">42</output>');
	});
});
