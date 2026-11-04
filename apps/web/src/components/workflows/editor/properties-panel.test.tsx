import { expect, test } from "bun:test";
import type { JsonValue } from "@tripwire/contracts";
import {
	Children,
	type ComponentProps,
	isValidElement,
	type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { FieldSpec } from "#/components/workflows/editor/node-fields";
import {
	ConfigField,
	PropertiesPanel,
} from "#/components/workflows/editor/properties-panel";
import { Input } from "#/design-system/ui/input";
import { Select } from "#/design-system/ui/select";
import { Textarea } from "#/design-system/ui/textarea";

function controls(
	field: FieldSpec,
	value: JsonValue | undefined,
	onChange: (next: JsonValue) => void,
) {
	const root = ConfigField({ field, value, onChange, readOnly: false });
	if (!isValidElement<{ children: ReactNode }>(root)) {
		throw new Error("Expected a field wrapper");
	}
	return Children.toArray(root.props.children);
}

const base = { key: "draft", label: "Draft", secret: false };

test("rule panel renders partial and malformed drafts without applying defaults", () => {
	const configs: JsonValue[] = [
		{},
		{ minDays: "-", extra: true },
		["unfinished"],
		null,
		false,
	];
	for (const config of configs) {
		const html = renderToStaticMarkup(
			<PropertiesPanel
				node={{ id: "r", type: "rule", ref: "account-age@1", config }}
				onUpdate={() => undefined}
				readOnly
			/>,
		);
		expect(html).toContain('data-field="minDays"');
		expect(html).toContain('value=""');
		expect(html).not.toContain('value="7"');
		expect(html).toContain("disabled");
	}
});

test("action properties keep saved-secret markers blank and controls disabled", () => {
	const html = renderToStaticMarkup(
		<PropertiesPanel
			node={{
				id: "delivery",
				type: "action",
				action: "webhook",
				params: { urlSet: true, signingSecretSet: true, extra: "retained" },
			}}
			onUpdate={() => undefined}
			readOnly
		/>,
	);
	expect(html.match(/Saved\. Leave blank to keep it/g)).toHaveLength(2);
	expect(html.match(/value=""/g)).toHaveLength(2);
	expect(html).toContain('data-layout-role="workflow-delivery-test"');
	expect(html).toContain("Test connection");
	for (const type of ["url", "password"]) {
		const inputs = html.match(
			new RegExp(`<input\\b[^>]*\\btype="${type}"[^>]*>`, "g"),
		);
		expect(inputs).toHaveLength(1);
		expect(inputs?.[0]).toContain('disabled=""');
	}
});

test.each([
	false,
	true,
])("delivery test button honors read-only=%s with a nonempty URL", (readOnly) => {
	const html = renderToStaticMarkup(
		<PropertiesPanel
			node={{
				id: "delivery",
				type: "action",
				action: "webhook",
				params: { url: "https://example.com/hook" },
			}}
			onUpdate={() => undefined}
			readOnly={readOnly}
		/>,
	);
	const buttons = html
		.match(/<button\b[^>]*>[\s\S]*?<\/button>/g)
		?.filter((button) => button.includes("Test connection"));
	expect(buttons).toHaveLength(1);
	const attributes = buttons?.[0]?.match(/^<button\b[^>]*>/)?.[0];
	if (readOnly) {
		expect(attributes).toContain('disabled=""');
	} else {
		expect(attributes).not.toContain('disabled=""');
	}
});

test("text and enum fields retain incomplete text and string-only read fallbacks", () => {
	const changes: JsonValue[] = [];
	const onChange = (next: JsonValue) => changes.push(next);
	const text = controls({ ...base, kind: "string" }, "-", onChange).find(
		(child) => isValidElement(child) && child.type === Input,
	);
	if (!isValidElement<ComponentProps<typeof Input>>(text)) {
		throw new Error("Expected text input");
	}
	expect(text.props.value).toBe("-");
	for (const value of [null, false, 4, ["draft"]]) {
		const html = renderToStaticMarkup(
			<ConfigField
				field={{ ...base, kind: "string" }}
				value={value}
				onChange={onChange}
				readOnly={false}
			/>,
		);
		expect(html).toContain('value=""');
	}
	const select = controls(
		{ ...base, kind: "enum", options: [0, 1, "pending"] },
		1,
		onChange,
	).find((child) => isValidElement(child) && child.type === Select);
	if (!isValidElement<ComponentProps<typeof Select>>(select)) {
		throw new Error("Expected enum select");
	}
	expect(select.props.items).toEqual([
		{ value: "0", label: 0 },
		{ value: "1", label: 1 },
		{ value: "pending", label: "pending" },
	]);
	expect(select.props.value).toBe("");
	select.props.onValueChange?.("1");
	select.props.onValueChange?.(null);
	expect(changes).toEqual(["1", ""]);
});

test("list editor stays uncontrolled and keeps mixed-list display fallbacks", () => {
	const changes: JsonValue[] = [];
	const textarea = controls(
		{ ...base, kind: "string-list" },
		["a", null, "", "b", 3],
		(next) => changes.push(next),
	).find((child) => isValidElement(child) && child.type === Textarea);
	if (!isValidElement<ComponentProps<typeof Textarea>>(textarea)) {
		throw new Error("Expected list textarea");
	}
	expect(textarea.props.defaultValue).toBe("a\n\nb");
	expect(textarea.props.value).toBeUndefined();
	expect(changes).toEqual([]);
});

test("JSON editor keeps an uncontrolled per-field draft instead of parsing on every keystroke", () => {
	const changes: JsonValue[] = [];
	const textarea = controls(
		{ ...base, kind: "json" },
		{ draft: true },
		(next) => changes.push(next),
	).find((child) => isValidElement(child) && child.type === Textarea);
	if (!isValidElement<ComponentProps<typeof Textarea>>(textarea)) {
		throw new Error("Expected JSON textarea");
	}
	expect(textarea.props.defaultValue).toBe('{\n  "draft": true\n}');
	expect(textarea.props.value).toBeUndefined();
	expect(changes).toEqual([]);
});
