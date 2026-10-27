import type { ResponseVariable, TextPart } from "@tripwire/contracts";
import { responseVariableSchema } from "@tripwire/contracts";

export function mergeParts(parts: readonly TextPart[]): TextPart[] {
	const merged: TextPart[] = [];
	for (const part of parts) {
		const last = merged.at(-1);
		if (part.kind === "text" && part.text === "") {
			continue;
		}
		if (part.kind === "text" && last?.kind === "text") {
			merged[merged.length - 1] = { kind: "text", text: last.text + part.text };
			continue;
		}
		merged.push(part);
	}
	return merged;
}

function variableOf(node: Node): ResponseVariable | null {
	if (!(node instanceof HTMLElement)) {
		return null;
	}
	const parsed = responseVariableSchema.safeParse(node.dataset.var);
	return parsed.success ? parsed.data : null;
}

function collect(node: Node, parts: TextPart[]): void {
	if (node.nodeType === Node.TEXT_NODE) {
		parts.push({ kind: "text", text: node.textContent ?? "" });
		return;
	}
	const name = variableOf(node);
	if (name) {
		parts.push({ kind: "var", name });
		return;
	}
	if (node.nodeName === "BR") {
		parts.push({ kind: "text", text: "\n" });
		return;
	}
	if (node.nodeName === "DIV" && node.previousSibling) {
		parts.push({ kind: "text", text: "\n" });
	}
	for (const child of node.childNodes) {
		collect(child, parts);
	}
}

export function partsFromNode(root: Node): TextPart[] {
	const parts: TextPart[] = [];
	for (const child of root.childNodes) {
		collect(child, parts);
	}
	return mergeParts(parts);
}

export function textLength(parts: readonly TextPart[]): number {
	return parts.reduce(
		(sum, part) => sum + (part.kind === "text" ? part.text.length : 0),
		0,
	);
}

export function fitParts(
	parts: readonly TextPart[],
	maxText: number,
	maxParts: number,
) {
	const fitted = mergeParts(clampParts(parts.slice(0, maxParts), maxText));
	return {
		parts: fitted,
		trimmed: parts.length > maxParts || textLength(fitted) < textLength(parts),
	};
}

export function clampParts(
	parts: readonly TextPart[],
	max: number,
): TextPart[] {
	let room = max;
	return parts.map((part) => {
		if (part.kind !== "text") {
			return part;
		}
		const text = part.text.slice(0, Math.max(0, room));
		room -= text.length;
		return { kind: "text", text };
	});
}

export function nodesFromParts(
	parts: readonly TextPart[],
	chip: (name: ResponseVariable) => Node,
): Node[] {
	return parts.map((part) =>
		part.kind === "text" ? document.createTextNode(part.text) : chip(part.name),
	);
}
