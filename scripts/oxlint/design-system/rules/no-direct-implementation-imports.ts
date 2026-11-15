import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";
import {
	isApplicationSource,
	isDesignSystemImplementation,
} from "../shared/scope.ts";

const DIRECT_IMPLEMENTATION =
	/^(?:(?:#|@)\/(?:components|lib)\/(?:glaze|quartz)|(?:\.\.?\/)+(?:.*\/)?(?:glaze|quartz))(?:\/|$)/;
const PRIVATE_PRIMITIVE = /^@ui-sdk\//;
const BASE_UI = /^@base-ui\/react(?:\/|$)/;
const LEGACY_FACADE = /^#\/design-system\/(?:icon|ui|lib)(?:\/|$)/;

function staticModuleSource(source: ESTree.Expression) {
	if (source.type === "Literal" && typeof source.value === "string") {
		return source.value;
	}
	if (
		source.type === "TemplateLiteral" &&
		source.expressions.length === 0 &&
		source.quasis[0]
	) {
		return source.quasis[0].value.cooked ?? source.quasis[0].value.raw;
	}
	return null;
}

/** Keep feature imports behind the application-owned design-system facade. */
export const noDirectImplementationImportsRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow direct design-system implementation imports from feature code.",
		},
		messages: {
			useFacade:
				'Reference the primitive through "@tripwire/ui" instead of "{{source}}".',
		},
	},
	create(context) {
		if (
			!isApplicationSource(context.filename) ||
			isDesignSystemImplementation(context.filename)
		) {
			return {};
		}
		const check = (node: ESTree.Node, source: string | null) => {
			if (
				source &&
				(PRIVATE_PRIMITIVE.test(source) ||
					DIRECT_IMPLEMENTATION.test(source) ||
					BASE_UI.test(source) ||
					LEGACY_FACADE.test(source))
			) {
				context.report({
					node,
					messageId: "useFacade",
					data: { source },
				});
			}
		};
		return {
			ImportDeclaration(node) {
				check(node, node.source.value);
			},
			ImportExpression(node) {
				check(node, staticModuleSource(node.source));
			},
			ExportNamedDeclaration(node) {
				check(node, node.source?.value ?? null);
			},
			ExportAllDeclaration(node) {
				check(node, node.source.value);
			},
		};
	},
});
