export const FEEDBACK_NAME_ATTR = "data-feedback-name";
export const FEEDBACK_CHROME_ATTR = "data-feedback-chrome";
export const CANDIDATE_SELECTOR = `[${FEEDBACK_NAME_ATTR}], [data-slot="card"]`;

const MASK_ATTR = "data-privacy";
const TEXT_MAX = 160;
const PATH_DEPTH = 6;

export interface PickNode {
	tagName: string;
	id?: string;
	parentElement: PickNode | null;
	getAttribute(name: string): string | null;
}

export interface PickTarget<T extends PickNode> {
	node: T;
	name: string;
}

export interface FeedbackElementSummary {
	name: string;
	trail: string[];
	path: string;
	text: string | null;
}

function pascal(slot: string): string {
	return slot
		.split("-")
		.filter(Boolean)
		.map((part) => part[0]?.toUpperCase() + part.slice(1))
		.join("");
}

export function nameOf(node: PickNode): string | null {
	const named = node.getAttribute(FEEDBACK_NAME_ATTR);
	if (named) {
		return named;
	}
	const slot = node.getAttribute("data-slot");
	return slot ? pascal(slot) : null;
}

function isChrome(node: PickNode): boolean {
	for (let at: PickNode | null = node; at; at = at.parentElement) {
		if (at.getAttribute(FEEDBACK_CHROME_ATTR) !== null) {
			return true;
		}
	}
	return false;
}

function isRoot(node: PickNode): boolean {
	const tag = node.tagName.toLowerCase();
	return tag === "body" || tag === "html";
}

export function resolvePick<T extends PickNode>(
	start: T | null,
): PickTarget<T> | null {
	if (!start || isRoot(start) || isChrome(start)) {
		return null;
	}
	let slot: T | null = null;
	for (
		let at: PickNode | null = start;
		at && !isRoot(at);
		at = at.parentElement
	) {
		if (at.getAttribute(FEEDBACK_NAME_ATTR)) {
			return { node: at as T, name: nameOf(at) ?? "" };
		}
		if (!slot && at.getAttribute("data-slot")) {
			slot = at as T;
		}
	}
	if (slot) {
		return { node: slot, name: nameOf(slot) ?? "" };
	}
	return { node: start, name: start.tagName.toLowerCase() };
}

export function trailOf(node: PickNode): string[] {
	const trail: string[] = [];
	for (
		let at: PickNode | null = node;
		at && !isRoot(at);
		at = at.parentElement
	) {
		const named = at.getAttribute(FEEDBACK_NAME_ATTR);
		if (named) {
			trail.unshift(named);
		}
	}
	return trail;
}

function segment(node: PickNode): string {
	const tag = node.tagName.toLowerCase();
	if (node.id) {
		return `${tag}#${node.id}`;
	}
	const named = node.getAttribute(FEEDBACK_NAME_ATTR);
	if (named) {
		return `${tag}[${FEEDBACK_NAME_ATTR}="${named}"]`;
	}
	const slot = node.getAttribute("data-slot");
	if (slot) {
		return `${tag}[data-slot="${slot}"]`;
	}
	return tag;
}

export function domPath(node: PickNode, depth = PATH_DEPTH): string {
	const parts: string[] = [];
	for (
		let at: PickNode | null = node;
		at && !isRoot(at) && parts.length < depth;
		at = at.parentElement
	) {
		parts.unshift(segment(at));
		if (at.id) {
			break;
		}
	}
	return parts.join(" > ");
}

export function snippet(text: string | null | undefined): string | null {
	const flat = (text ?? "").replace(/\s+/g, " ").trim();
	if (!flat) {
		return null;
	}
	return flat.length <= TEXT_MAX ? flat : `${flat.slice(0, TEXT_MAX - 3)}...`;
}

export function isMasked(node: PickNode): boolean {
	for (let at: PickNode | null = node; at; at = at.parentElement) {
		if (at.getAttribute(MASK_ATTR) === "masked") {
			return true;
		}
	}
	return false;
}

export function summarize(
	target: PickTarget<PickNode>,
	visibleText: string | null,
): FeedbackElementSummary {
	return {
		name: target.name,
		trail: trailOf(target.node),
		path: domPath(target.node),
		text: isMasked(target.node) ? null : snippet(visibleText),
	};
}

export function visibleTextOf(element: Element): string {
	const clone = element.cloneNode(true) as Element;
	for (const masked of clone.querySelectorAll(`[${MASK_ATTR}="masked"]`)) {
		masked.remove();
	}
	const parts: string[] = [];
	const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
	for (let text = walker.nextNode(); text; text = walker.nextNode()) {
		parts.push(text.textContent ?? "");
	}
	return parts.join(" ");
}
