import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";
import { isApplicationSource, ownsLayoutGeometry } from "../shared/scope.ts";

function propertyName(key: ESTree.ObjectProperty["key"]) {
	if (key.type === "Identifier") return key.name;
	if (key.type === "Literal" && typeof key.value === "string") {
		return key.value;
	}
	return null;
}

function containsStyleProperty(expression: ESTree.Expression): boolean {
	if (expression.type === "ObjectExpression") {
		return expression.properties.some((property) => {
			if (property.type === "SpreadElement") {
				return containsStyleProperty(property.argument);
			}
			return propertyName(property.key) === "style";
		});
	}
	if (expression.type === "ConditionalExpression") {
		return (
			containsStyleProperty(expression.consequent) ||
			containsStyleProperty(expression.alternate)
		);
	}
	if (expression.type === "LogicalExpression") {
		return (
			containsStyleProperty(expression.left) ||
			containsStyleProperty(expression.right)
		);
	}
	if (
		expression.type === "ParenthesizedExpression" ||
		expression.type === "ChainExpression" ||
		expression.type === "TSAsExpression" ||
		expression.type === "TSSatisfiesExpression" ||
		expression.type === "TSTypeAssertion" ||
		expression.type === "TSNonNullExpression"
	) {
		return containsStyleProperty(expression.expression);
	}
	return false;
}

/** Keep visual style ownership inside semantic components and layout molecules. */
export const noInlineVisualStylesRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow JSX style escape hatches in application feature code.",
		},
		messages: {
			useContract:
				"Move visual styling into a semantic component or contextual molecule instead of using the style prop.",
		},
	},
	create(context) {
		if (
			!isApplicationSource(context.filename) ||
			ownsLayoutGeometry(context.filename)
		) {
			return {};
		}
		return {
			JSXAttribute(node) {
				if (node.name.type === "JSXIdentifier" && node.name.name === "style") {
					context.report({ node, messageId: "useContract" });
				}
			},
			JSXSpreadAttribute(node) {
				if (containsStyleProperty(node.argument)) {
					context.report({ node, messageId: "useContract" });
				}
			},
		};
	},
});
