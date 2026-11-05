import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";
import {
	classAttributeStrings,
	classCallStrings,
	classPropertyStrings,
	classVariableStrings,
	matchingClassToken,
} from "../shared/class-values.ts";
import {
	isApplicationSource,
	isDesignSystemImplementation,
} from "../shared/scope.ts";

const RAW_TYPOGRAPHY =
	/^(?:type-(?:title|heading(?:-sm)?|body(?:-sm)?|label(?:-sm)?|caption|code(?:-xs|-sm)?|metric)|text-(?:xs|sm|base|lg|xl|[2-9]xl)|font-(?:sans|serif|mono|normal|medium|semibold|bold)|leading-.+|tracking-.+)$/;

/** Require application typography roles instead of visual type utilities. */
export const noRawTypographyRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow raw typography utilities in application feature code.",
		},
		messages: {
			useRole:
				'Use a semantic typography role instead of the raw "{{token}}" utility.',
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
			const token = matchingClassToken(values, RAW_TYPOGRAPHY);
			if (token) {
				context.report({ node, messageId: "useRole", data: { token } });
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
