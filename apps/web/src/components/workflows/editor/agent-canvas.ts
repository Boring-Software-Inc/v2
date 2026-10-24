import type { WorkflowChangeSet } from "@tripwire/contracts";
import type { CSSProperties } from "react";

export const AGENT_STAGGER_MS = 90;
export const AGENT_SETTLE_MS = 1600;

const LIVE_CLASSES = [
	"agent-enter",
	"agent-pulse-a",
	"agent-pulse-b",
	"agent-leave",
	"agent-trail",
	"agent-trail-out",
];
const GHOST_CLASSES = new Set(["agent-leave", "agent-trail-out"]);

interface Piece {
	id: string;
	className?: string;
	style?: CSSProperties;
}

function withClass<T extends Piece>(piece: T, name: string, delay: number): T {
	return {
		...piece,
		className: name,
		style: { ...piece.style, "--agent-delay": `${delay}ms` } as CSSProperties,
	};
}

function ghost<T extends Piece>(piece: T, name: string): T {
	return {
		...withClass(piece, name, 0),
		selectable: false,
		deletable: false,
		draggable: false,
		focusable: false,
	};
}

/**
 * Marks what one agent change did to the canvas: new nodes fade in one after
 * another, new edges draw in behind them like a trail, changed nodes pulse,
 * and removed nodes and edges stay a moment to fade out.
 */
export function decorateLive<N extends Piece, E extends Piece>(input: {
	previous: { nodes: readonly N[]; edges: readonly E[] };
	next: { nodes: readonly N[]; edges: readonly E[] };
	change: WorkflowChangeSet | null;
	revision: number;
}): { nodes: N[]; edges: E[] } {
	const { change, next, previous } = input;
	if (!change) {
		return { nodes: [...next.nodes], edges: [...next.edges] };
	}
	const added = new Map(change.nodes.added.map((id, index) => [id, index]));
	const changed = new Set(change.nodes.changed);
	const pulse = input.revision % 2 === 0 ? "agent-pulse-a" : "agent-pulse-b";
	const nodes = next.nodes.map((node) => {
		const order = added.get(node.id);
		if (order !== undefined) {
			return withClass(node, "agent-enter", order * AGENT_STAGGER_MS);
		}
		return changed.has(node.id) ? withClass(node, pulse, 0) : node;
	});
	const removed = new Set(change.nodes.removed);
	const leaving = previous.nodes
		.filter((node) => removed.has(node.id))
		.map((node) => ghost(node, "agent-leave"));
	const trail = new Set(change.edges.added);
	const lastEnter = Math.max(0, added.size - 1) * AGENT_STAGGER_MS;
	const edges = next.edges.map((edge, index) =>
		trail.has(edge.id)
			? withClass(edge, "agent-trail", lastEnter / 2 + index * AGENT_STAGGER_MS)
			: edge,
	);
	const cut = new Set(change.edges.removed);
	const kept = new Set(next.edges.map((edge) => edge.id));
	const fading = previous.edges
		.filter((edge) => cut.has(edge.id) && !kept.has(edge.id))
		.map((edge) => ghost(edge, "agent-trail-out"));
	return { nodes: [...nodes, ...leaving], edges: [...edges, ...fading] };
}

/** Drops the faded pieces and the animation marks once the motion ends. */
export function settleLive<T extends Piece>(pieces: readonly T[]): T[] {
	return pieces.flatMap((piece) => {
		if (!piece.className) {
			return [piece];
		}
		const names = piece.className.split(" ");
		if (names.some((name) => GHOST_CLASSES.has(name))) {
			return [];
		}
		const rest = names.filter((name) => !LIVE_CLASSES.includes(name));
		if (rest.length === names.length) {
			return [piece];
		}
		return [{ ...piece, className: rest.join(" ") || undefined }];
	});
}
