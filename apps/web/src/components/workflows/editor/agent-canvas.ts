import type { WorkflowChangeSet } from "@tripwire/contracts";
import type { CSSProperties } from "react";

export const AGENT_ENTER_MS = 340;
export const AGENT_STAGGER_MS = 60;
export const AGENT_TRAIL_MS = 140;
export const AGENT_LEAVE_MS = 200;
export const AGENT_PULSE_MS = 1000;
export const AGENT_FRESH_MS = 2000;
export const AGENT_SETTLE_SLACK_MS = 150;

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

interface Link extends Piece {
	source: string;
	target: string;
}

function withMotion<T extends Piece>(
	piece: T,
	name: string,
	delay: number,
	duration: number,
): T {
	return {
		...piece,
		className: name,
		style: {
			...piece.style,
			"--agent-delay": `${delay}ms`,
			"--agent-duration": `${duration}ms`,
		} as CSSProperties,
	};
}

function ghost<T extends Piece>(piece: T, name: string): T {
	return {
		...withMotion(piece, name, 0, AGENT_LEAVE_MS),
		selectable: false,
		deletable: false,
		draggable: false,
		focusable: false,
	};
}

export interface LiveGraph<N, E> {
	nodes: N[];
	edges: E[];
	settleMs: number;
	entering: ReadonlyMap<string, number>;
}

/**
 * Marks what one agent change did to the canvas: new nodes fade in one after
 * another, each new edge draws in once both of its ends are in, changed nodes
 * pulse, and removed nodes and edges stay a moment to fade out. settleMs is
 * when the last of that motion ends.
 */
export function decorateLive<N extends Piece, E extends Link>(input: {
	previous: { nodes: readonly N[]; edges: readonly E[] };
	next: { nodes: readonly N[]; edges: readonly E[] };
	change: WorkflowChangeSet | null;
	revision: number;
}): LiveGraph<N, E> {
	const { change, next, previous } = input;
	if (!change) {
		return {
			nodes: [...next.nodes],
			edges: [...next.edges],
			settleMs: 0,
			entering: new Map(),
		};
	}
	let settleMs = 0;
	const ends = (at: number) => {
		settleMs = Math.max(settleMs, at);
	};
	const enterAt = new Map(
		change.nodes.added.map((id, index) => [id, index * AGENT_STAGGER_MS]),
	);
	const changed = new Set(change.nodes.changed);
	const pulse = input.revision % 2 === 0 ? "agent-pulse-a" : "agent-pulse-b";
	const nodes = next.nodes.map((node) => {
		const delay = enterAt.get(node.id);
		if (delay !== undefined) {
			ends(delay + AGENT_ENTER_MS);
			return withMotion(node, "agent-enter", delay, AGENT_ENTER_MS);
		}
		if (changed.has(node.id)) {
			ends(AGENT_PULSE_MS);
			return withMotion(node, pulse, 0, AGENT_PULSE_MS);
		}
		return node;
	});
	const removed = new Set(change.nodes.removed);
	const leaving = previous.nodes
		.filter((node) => removed.has(node.id))
		.map((node) => ghost(node, "agent-leave"));
	const inAt = (id: string) => {
		const delay = enterAt.get(id);
		return delay === undefined ? 0 : delay + AGENT_ENTER_MS;
	};
	const trail = new Set(change.edges.added);
	const edges = next.edges.map((edge) => {
		if (!trail.has(edge.id)) {
			return edge;
		}
		const delay = Math.max(inAt(edge.source), inAt(edge.target));
		ends(delay + AGENT_TRAIL_MS);
		return withMotion(edge, "agent-trail", delay, AGENT_TRAIL_MS);
	});
	const cut = new Set(change.edges.removed);
	const kept = new Set(next.edges.map((edge) => edge.id));
	const fading = previous.edges
		.filter((edge) => cut.has(edge.id) && !kept.has(edge.id))
		.map((edge) => ghost(edge, "agent-trail-out"));
	if (leaving.length > 0 || fading.length > 0) {
		ends(AGENT_LEAVE_MS);
	}
	return {
		nodes: [...nodes, ...leaving],
		edges: [...edges, ...fading],
		settleMs,
		entering: enterAt,
	};
}

export function freshOnMount(changedAt: string | null, now: Date): boolean {
	if (!changedAt) {
		return false;
	}
	return Math.abs(now.getTime() - Date.parse(changedAt)) < AGENT_FRESH_MS;
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
