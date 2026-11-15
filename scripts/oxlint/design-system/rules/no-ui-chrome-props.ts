import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";
import { isApplicationSource } from "../shared/scope.ts";

const FORBIDDEN_PROPS = new Set([
	"asChild",
	"className",
	"classes",
	"css",
	"render",
	"slotProps",
	"style",
	"sx",
	"unstyled",
]);

function propertyName(property: ESTree.Property) {
	if (!property.computed && property.key.type === "Identifier") {
		return property.key.name;
	}
	if (
		property.key.type === "Literal" &&
		typeof property.key.value === "string"
	) {
		return property.key.value;
	}
	return null;
}

/** Keep application chrome behind finite semantic component props. */
export const noUiChromePropsRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow raw styling and polymorphic escape hatches on @tripwire/ui components.",
		},
		messages: {
			semanticProp:
				'"{{prop}}" bypasses the semantic @tripwire/ui contract; add a finite semantic variant instead.',
		},
	},
	create(context) {
		if (!isApplicationSource(context.filename)) {
			return {};
		}

		const components = new Set<string>();
		const namespaces = new Set<string>();
		const report = (node: ESTree.Node, prop: string) => {
			context.report({ node, messageId: "semanticProp", data: { prop } });
		};
		const isForbidden = (prop: string) =>
			FORBIDDEN_PROPS.has(prop) || prop.startsWith("--");

		return {
			ImportDeclaration(node) {
				if (!node.source.value.startsWith("@tripwire/ui")) {
					return;
				}
				for (const specifier of node.specifiers) {
					if (specifier.type === "ImportNamespaceSpecifier") {
						namespaces.add(specifier.local.name);
					} else if (specifier.type === "ImportSpecifier") {
						components.add(specifier.local.name);
					}
				}
			},
			JSXOpeningElement(node) {
				const direct =
					node.name.type === "JSXIdentifier" && components.has(node.name.name);
				const namespaced =
					node.name.type === "JSXMemberExpression" &&
					node.name.object.type === "JSXIdentifier" &&
					namespaces.has(node.name.object.name);
				if (!(direct || namespaced)) {
					return;
				}

				for (const attribute of node.attributes) {
					if (
						attribute.type === "JSXAttribute" &&
						attribute.name.type === "JSXIdentifier" &&
						isForbidden(attribute.name.name)
					) {
						report(attribute, attribute.name.name);
					}
					if (
						attribute.type === "JSXSpreadAttribute" &&
						attribute.argument.type === "ObjectExpression"
					) {
						for (const property of attribute.argument.properties) {
							if (property.type !== "Property") {
								continue;
							}
							const prop = propertyName(property);
							if (prop && isForbidden(prop)) {
								report(property, prop);
							}
						}
					}
				}
			},
		};
	},
});
