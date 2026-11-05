import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";
import {
	classAttributeStrings,
	classCallStrings,
	classPropertyStrings,
	classVariableStrings,
	matchingClassToken,
} from "../shared/class-values.ts";
import { isApplicationSource, ownsLayoutGeometry } from "../shared/scope.ts";

const ARBITRARY_TAILWIND_VALUE = /\[[^\]]+\]/;

/** Keep arbitrary Tailwind recipes inside design-system and layout implementations. */
export const noArbitraryTailwindValuesRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow arbitrary Tailwind values and selectors in application feature code.",
		},
		messages: {
			useContract:
				'Use a semantic component or molecule instead of the arbitrary Tailwind token "{{token}}".',
		},
	},
	create(context) {
		if (
			!isApplicationSource(context.filename) ||
			ownsLayoutGeometry(context.filename)
		) {
			return {};
		}
		const check = (node: ESTree.Node, values: string[]) => {
			const token = matchingClassToken(values, ARBITRARY_TAILWIND_VALUE);
			if (token) {
				context.report({
					node,
					messageId: "useContract",
					data: { token },
				});
			}
		};
		return {
			JSXAttribute(node) {
				check(node, classAttributeStrings(node));
			},
			CallExpression(node) {
				check(node, classCallStrings(node));
			},
			VariableDeclarator(node) {
				check(node, classVariableStrings(node));
			},
			Property(node) {
				check(node, classPropertyStrings(node));
			},
		};
	},
});
