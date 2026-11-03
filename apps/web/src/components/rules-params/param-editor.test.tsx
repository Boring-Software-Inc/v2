import { describe, expect, test } from "bun:test";
import type { JsonValue, RuleParam } from "@tripwire/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { ParamEditor } from "#/components/rules-params/param-editor";

const noop = () => {};

function renderEditor(param: RuleParam, value: JsonValue | undefined) {
	return renderToStaticMarkup(
		<ParamEditor onCancel={noop} onSave={noop} param={param} value={value} />,
	);
}

const NUMBER_PARAM = {
	key: "count",
	label: "Count",
	kind: "number",
	int: true,
	min: 1,
	max: 10,
	default: 3,
} satisfies RuleParam;

const STRING_PARAM = {
	key: "text",
	label: "Text",
	kind: "string",
	default: "default text",
} satisfies RuleParam;

const ENUM_PARAM = {
	key: "mode",
	label: "Mode",
	kind: "enum",
	options: ["a", "b"],
	default: "a",
} satisfies RuleParam;

describe("ParamEditor presentation parsing", () => {
	test("finite numbers stay editable even outside bounds or integer constraints", () => {
		for (const value of [0, -1, 12, 1.5]) {
			expect(renderEditor(NUMBER_PARAM, value)).toContain(`value="${value}"`);
		}
	});

	test("missing, null and other JSON representations use the numeric default without coercion", () => {
		for (const value of [undefined, null, "7", true, [], { count: 7 }]) {
			expect(renderEditor(NUMBER_PARAM, value)).toContain('value="3"');
		}
	});

	test("non-JSON numeric values fall back instead of rendering NaN or Infinity", () => {
		for (const value of [
			Number.NaN,
			Number.POSITIVE_INFINITY,
			Number.NEGATIVE_INFINITY,
		]) {
			expect(renderEditor(NUMBER_PARAM, value)).toContain('value="3"');
		}
	});

	test("percent display still scales and rounds the stored number", () => {
		const param = { ...NUMBER_PARAM, percent: true, default: 0.25 };
		expect(renderEditor(param, 0.456)).toContain('value="46"');
		expect(renderEditor(param, null)).toContain('value="25"');
		expect(renderEditor(param, 1.5)).toContain('value="150"');
	});

	test("string drafts keep empty text and whitespace verbatim", () => {
		for (const value of ["", "  incomplete  ", "{not JSON"]) {
			expect(renderEditor(STRING_PARAM, value)).toContain(`value="${value}"`);
		}
	});

	test("string defaults handle missing, null and other JSON values without stringifying them", () => {
		for (const value of [undefined, null, 7, false, [], { text: "draft" }]) {
			expect(renderEditor(STRING_PARAM, value)).toContain(
				'value="default text"',
			);
		}
		expect(
			renderEditor({ kind: "string", key: "text", label: "Text" }, null),
		).toContain('value=""');
	});

	test("enum values default only for non-strings, not strings outside the options", () => {
		expect(renderEditor(ENUM_PARAM, "b")).toContain(
			'<option value="b" selected="">',
		);
		for (const value of [undefined, null, 7, false, [], { mode: "b" }]) {
			expect(renderEditor(ENUM_PARAM, value)).toContain(
				'<option value="a" selected="">',
			);
		}
		for (const value of ["", "not-an-option"]) {
			expect(renderEditor(ENUM_PARAM, value)).not.toContain('selected=""');
		}
	});

	test("initializing an editor never saves or cancels an invalid draft", () => {
		const saved: JsonValue[] = [];
		let cancelled = false;
		renderToStaticMarkup(
			<ParamEditor
				onCancel={() => {
					cancelled = true;
				}}
				onSave={(value) => saved.push(value)}
				param={NUMBER_PARAM}
				value={{ count: "incomplete" }}
			/>,
		);
		expect(saved).toEqual([]);
		expect(cancelled).toBe(false);
	});
});
