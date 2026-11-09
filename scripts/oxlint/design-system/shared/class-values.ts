import type { ESTree } from "@oxlint/plugins";

const CLASS_HELPERS = new Set([
	"cn",
	"cva",
	"clsx",
	"mergeClass",
	"twJoin",
	"twMerge",
]);

function isClassName(name: string) {
	return (
		/(?:^|[_-])class(?:es|name|names)?(?:[_-]|$)/i.test(name) ||
		/Class(?:es|Name|Names)?(?:[A-Z0-9]|$)/.test(name)
	);
}

function staticPropertyName(key: ESTree.ObjectProperty["key"]) {
	if (key.type === "Identifier") return key.name;
	if (key.type === "Literal" && typeof key.value === "string") {
		return key.value;
	}
	return null;
}

function classHelperName(callee: ESTree.Expression) {
	if (callee.type === "Identifier") return callee.name;
	if (
		callee.type === "MemberExpression" &&
		!callee.computed &&
		callee.property.type === "Identifier"
	) {
		return callee.property.name;
	}
	return null;
}

function isClassHelperCall(expression: ESTree.Expression) {
	return (
		expression.type === "CallExpression" &&
		CLASS_HELPERS.has(classHelperName(expression.callee) ?? "")
	);
}

function expressionStrings(
	expression: ESTree.Expression,
	includeObjectKeys: boolean,
): string[] {
	if (expression.type === "Literal" && typeof expression.value === "string") {
		return [expression.value];
	}
	if (expression.type === "TemplateLiteral") {
		return [
			...expression.quasis.map((quasi) => quasi.value.raw),
			...expression.expressions.flatMap((value) =>
				expressionStrings(value, includeObjectKeys),
			),
		];
	}
	if (expression.type === "ConditionalExpression") {
		return [
			...expressionStrings(expression.consequent, includeObjectKeys),
			...expressionStrings(expression.alternate, includeObjectKeys),
		];
	}
	if (expression.type === "LogicalExpression") {
		return [
			...expressionStrings(expression.left, includeObjectKeys),
			...expressionStrings(expression.right, includeObjectKeys),
		];
	}
	if (expression.type === "ArrayExpression") {
		return expression.elements.flatMap((element) => {
			if (!element) return [];
			return expressionStrings(
				element.type === "SpreadElement" ? element.argument : element,
				includeObjectKeys,
			);
		});
	}
	if (expression.type === "ObjectExpression") {
		return expression.properties.flatMap((property) => {
			if (property.type === "SpreadElement") {
				return expressionStrings(property.argument, includeObjectKeys);
			}
			const key = includeObjectKeys ? staticPropertyName(property.key) : null;
			const computedKey =
				includeObjectKeys &&
				property.computed &&
				property.key.type !== "PrivateIdentifier"
					? expressionStrings(property.key, true)
					: [];
			return [
				...(key ? [key] : []),
				...computedKey,
				...expressionStrings(property.value, includeObjectKeys),
			];
		});
	}
	if (expression.type === "SequenceExpression") {
		return expression.expressions.flatMap((value) =>
			expressionStrings(value, includeObjectKeys),
		);
	}
	if (expression.type === "AssignmentExpression") {
		return expressionStrings(expression.right, includeObjectKeys);
	}
	if (expression.type === "AwaitExpression") {
		return expressionStrings(expression.argument, includeObjectKeys);
	}
	if (
		expression.type === "ParenthesizedExpression" ||
		expression.type === "ChainExpression" ||
		expression.type === "TSAsExpression" ||
		expression.type === "TSSatisfiesExpression" ||
		expression.type === "TSTypeAssertion" ||
		expression.type === "TSNonNullExpression" ||
		expression.type === "TSInstantiationExpression"
	) {
		return expressionStrings(expression.expression, includeObjectKeys);
	}
	return [];
}

export function isObjectExpressionProperty(
	node: ESTree.Node,
): node is ESTree.ObjectProperty {
	return node.type === "Property" && node.parent.type === "ObjectExpression";
}

function isInsideClassVariable(node: ESTree.Node) {
	let parent: ESTree.Node | null = node.parent;
	while (parent) {
		if (parent.type === "VariableDeclarator") {
			return parent.id.type === "Identifier" && isClassName(parent.id.name);
		}
		if (
			parent.type !== "Property" &&
			parent.type !== "ObjectExpression" &&
			parent.type !== "ArrayExpression" &&
			parent.type !== "SpreadElement" &&
			parent.type !== "TSAsExpression" &&
			parent.type !== "TSSatisfiesExpression" &&
			parent.type !== "TSTypeAssertion" &&
			parent.type !== "TSNonNullExpression" &&
			parent.type !== "ParenthesizedExpression"
		) {
			return false;
		}
		parent = parent.parent;
	}
	return false;
}

export function classAttributeStrings(node: ESTree.JSXAttribute): string[] {
	if (node.name.type !== "JSXIdentifier" || node.name.name !== "className") {
		return [];
	}
	if (!node.value) return [];
	if (node.value.type === "Literal" && typeof node.value.value === "string") {
		return [node.value.value];
	}
	if (
		node.value.type === "JSXExpressionContainer" &&
		node.value.expression.type !== "JSXEmptyExpression"
	) {
		return expressionStrings(node.value.expression, false);
	}
	return [];
}

export function classVariableStrings(
	node: ESTree.VariableDeclarator,
): string[] {
	if (
		node.id.type !== "Identifier" ||
		!isClassName(node.id.name) ||
		!node.init ||
		isClassHelperCall(node.init)
	) {
		return [];
	}
	return expressionStrings(node.init, false);
}

export function classPropertyStrings(node: ESTree.Node): string[] {
	if (!isObjectExpressionProperty(node)) return [];
	const name = staticPropertyName(node.key);
	if (!name || !isClassName(name) || isInsideClassVariable(node)) return [];
	return expressionStrings(node.value, false);
}

export function classCallStrings(node: ESTree.CallExpression): string[] {
	const helper = classHelperName(node.callee);
	if (!helper || !CLASS_HELPERS.has(helper)) return [];
	const includeObjectKeys = helper !== "cva";
	return node.arguments.flatMap((argument) =>
		expressionStrings(
			argument.type === "SpreadElement" ? argument.argument : argument,
			includeObjectKeys,
		),
	);
}

function baseTailwindToken(token: string) {
	let squareDepth = 0;
	let roundDepth = 0;
	let lastVariantSeparator = -1;
	for (let index = 0; index < token.length; index += 1) {
		const character = token[index];
		if (character === "[") squareDepth += 1;
		else if (character === "]") squareDepth = Math.max(0, squareDepth - 1);
		else if (character === "(") roundDepth += 1;
		else if (character === ")") roundDepth = Math.max(0, roundDepth - 1);
		else if (character === ":" && squareDepth === 0 && roundDepth === 0) {
			lastVariantSeparator = index;
		}
	}
	return lastVariantSeparator === -1
		? token
		: token.slice(lastVariantSeparator + 1);
}

export function matchingClassToken(values: string[], pattern: RegExp) {
	for (const value of values) {
		for (const token of value.split(/\s+/)) {
			if (!token) continue;
			const base = baseTailwindToken(token);
			const candidates = [token, base];
			if (base.startsWith("!")) candidates.push(base.slice(1));
			for (const candidate of candidates) {
				pattern.lastIndex = 0;
				if (pattern.test(candidate)) return token;
			}
		}
	}
	return null;
}
