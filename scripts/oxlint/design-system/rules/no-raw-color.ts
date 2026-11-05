import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";
import {
	classAttributeStrings,
	classCallStrings,
	classPropertyStrings,
	classVariableStrings,
	isObjectExpressionProperty,
	matchingClassToken,
} from "../shared/class-values.ts";
import {
	isApplicationSource,
	isDesignSystemImplementation,
} from "../shared/scope.ts";

const TOKEN_COLOR =
	/^(?:text|bg|border(?:-[trblxyse])?|ring|outline|fill|stroke)-(?:text-[123]|text-disabled|text-inverse|page|paper|field|ink(?:-.+)?|line(?:-.+)?|focus|hover(?:-.+)?|pressed|ok(?:-.+)?|warn(?:-.+)?|fail(?:-.+)?|agent|feedback-outline-(?:inner|outer)|black|white|transparent|current|inherit|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3})(?:\/\d{1,3})?$/;
const ARBITRARY_COLOR =
	/^(?:text|bg|border|ring|outline|fill|stroke)-\[(?:#|rgb|hsl|oklch|color:|var\(--)/;
const COLOR_LITERAL = /^(?:#[\da-f]{3,8}|(?:rgb|rgba|hsl|hsla|oklch|color)\()/i;
const COLOR_PROPERTIES = new Set([
	"background",
	"backgroundColor",
	"borderColor",
	"color",
	"fill",
	"outlineColor",
	"stroke",
]);

function propertyName(node: ESTree.ObjectProperty["key"]) {
	if (node.type === "Identifier") return node.name;
	if (node.type === "Literal" && typeof node.value === "string") {
		return node.value;
	}
	return null;
}

function jsxStringValue(node: ESTree.JSXAttribute) {
	if (node.value?.type === "Literal" && typeof node.value.value === "string") {
		return node.value.value;
	}
	if (
		node.value?.type === "JSXExpressionContainer" &&
		node.value.expression.type === "Literal" &&
		typeof node.value.expression.value === "string"
	) {
		return node.value.expression.value;
	}
	return null;
}

/** Require application semantic color roles instead of implementation colors. */
export const noRawColorRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow raw color utilities and literals in application feature code.",
		},
		messages: {
			useRole: 'Use an application semantic color role instead of "{{value}}".',
		},
	},
	create(context) {
		if (
			!isApplicationSource(context.filename) ||
			isDesignSystemImplementation(context.filename)
		) {
			return {};
		}
		const check = (node: ESTree.Node, values: string[]) => {
			const token =
				matchingClassToken(values, TOKEN_COLOR) ??
				matchingClassToken(values, ARBITRARY_COLOR);
			if (token) {
				context.report({
					node,
					messageId: "useRole",
					data: { value: token },
				});
			}
		};
		return {
			CallExpression(node) {
				check(node, classCallStrings(node));
			},
			VariableDeclarator(node) {
				check(node, classVariableStrings(node));
			},
			Property(node) {
				check(node, classPropertyStrings(node));
				if (!isObjectExpressionProperty(node)) return;
				const name = propertyName(node.key);
				if (!name || !COLOR_PROPERTIES.has(name)) return;
				if (
					node.value.type === "Literal" &&
					typeof node.value.value === "string" &&
					(COLOR_LITERAL.test(node.value.value) ||
						node.value.value.includes("var(--"))
				) {
					context.report({
						node,
						messageId: "useRole",
						data: { value: node.value.value },
					});
				}
			},
			JSXAttribute(node) {
				check(node, classAttributeStrings(node));
				const value = jsxStringValue(node);
				if (
					node.name.type === "JSXIdentifier" &&
					COLOR_PROPERTIES.has(node.name.name) &&
					value &&
					(COLOR_LITERAL.test(value) || value.includes("var(--"))
				) {
					context.report({
						node,
						messageId: "useRole",
						data: { value },
					});
				}
			},
		};
	},
});
