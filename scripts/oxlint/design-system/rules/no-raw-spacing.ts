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

const RAW_SPACING =
	/^(?:(?:-?m[trblxyse]?|p[trblxyse]?|gap(?:-[xy])?|space-[xy])-.+|\[(?:margin|padding|gap)(?:-.+)?:.+\])$/;

/** Keep application spacing inside contextual molecules and component recipes. */
export const noRawSpacingRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow raw spacing utilities in application feature code.",
		},
		messages: {
			useMolecule:
				'Use a contextual molecule instead of choosing spacing with "{{token}}".',
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
			const token = matchingClassToken(values, RAW_SPACING);
			if (token) {
				context.report({
					node,
					messageId: "useMolecule",
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
