import type {
	JsonValue,
	WorkflowDefinition,
	WorkflowEdge,
	WorkflowNode,
} from "@tripwire/contracts";

type Graph = Pick<WorkflowDefinition, "nodes" | "edges">;
type RuleNode = Extract<WorkflowNode, { type: "rule" }>;
export type SkipMode = "all-of" | "any-of";

export interface GroupCard {
	kind: "group";
	id: string;
	ruleIds: string[];
	gateId: string | null;
	unlessId: string | null;
	skipId: string | null;
	triggerIds: string[];
}

export interface SkipCard {
	kind: "skip";
	id: string;
	mode: SkipMode;
	checkIds: string[];
	gateId: string | null;
	unlessId: string;
	groupId: string;
}

export type RuleCard = GroupCard | SkipCard;

export interface RuleGroupsView {
	cards: ReadonlyMap<string, RuleCard>;
	memberOf: ReadonlyMap<string, string>;
	hiddenEdges: ReadonlySet<string>;
	viewEdges: readonly WorkflowEdge[];
}

export const VIEW_EDGE_PREFIX = "view:";

function incoming(graph: Graph, id: string): WorkflowEdge[] {
	return graph.edges.filter((edge) => edge.to === id);
}

function outgoing(graph: Graph, id: string): WorkflowEdge[] {
	return graph.edges.filter((edge) => edge.from === id);
}

function nodeOf(graph: Graph, id: string): WorkflowNode | undefined {
	return graph.nodes.find((node) => node.id === id);
}

function isTrigger(graph: Graph, id: string): boolean {
	return nodeOf(graph, id)?.type === "trigger";
}

function memberRule(graph: Graph, id: string, parentId: string): boolean {
	const node = nodeOf(graph, id);
	if (node?.type !== "rule") {
		return false;
	}
	const out = outgoing(graph, id);
	return (
		out.length === 1 &&
		out[0]?.to === parentId &&
		out[0].when === undefined &&
		incoming(graph, id).every((edge) => isTrigger(graph, edge.from))
	);
}

function membersOf(graph: Graph, gateId: string): string[] | null {
	const sources = incoming(graph, gateId).map((edge) => edge.from);
	return sources.every((id) => memberRule(graph, id, gateId)) ? sources : null;
}

function triggersOf(graph: Graph, ids: readonly string[]): string[] {
	const found = new Set<string>();
	for (const id of ids) {
		for (const edge of incoming(graph, id)) {
			if (isTrigger(graph, edge.from)) {
				found.add(edge.from);
			}
		}
	}
	return [...found];
}

function failsToActions(graph: Graph, id: string): boolean {
	const out = outgoing(graph, id);
	return (
		out.length > 0 &&
		out.every(
			(edge) =>
				edge.when === "fail" && nodeOf(graph, edge.to)?.type === "action",
		)
	);
}

function soleEdgeTo(
	graph: Graph,
	from: string,
	to: string,
	input: "requirement" | "exception",
): boolean {
	const out = outgoing(graph, from);
	return (
		out.length === 1 &&
		out[0]?.to === to &&
		out[0].input === input &&
		out[0].when === undefined
	);
}

interface Found {
	card: RuleCard;
	members: string[];
	hidden: string[];
}

function unlessCards(graph: Graph, unless: WorkflowNode): Found[] {
	if (unless.type !== "gate" || unless.mode !== "unless") {
		return [];
	}
	const into = incoming(graph, unless.id);
	const required = into.filter((edge) => edge.input === "requirement");
	const excepted = into.filter((edge) => edge.input === "exception");
	const [requirement] = required;
	const [exception] = excepted;
	if (
		!requirement ||
		!exception ||
		required.length !== 1 ||
		excepted.length !== 1 ||
		into.length !== 2 ||
		!outgoing(graph, unless.id).every(
			(edge) =>
				edge.when === "fail" && nodeOf(graph, edge.to)?.type === "action",
		)
	) {
		return [];
	}
	const source = nodeOf(graph, requirement.from);
	let ruleIds: string[] | null = null;
	let gateId: string | null = null;
	if (source?.type === "rule" && memberRule(graph, source.id, unless.id)) {
		ruleIds = [source.id];
	} else if (
		source?.type === "gate" &&
		source.mode === "all-of" &&
		soleEdgeTo(graph, source.id, unless.id, "requirement")
	) {
		const members = membersOf(graph, source.id);
		if (members && members.length > 0) {
			ruleIds = members;
			gateId = source.id;
		}
	}
	if (!ruleIds) {
		return [];
	}
	const check = nodeOf(graph, exception.from);
	let skip: {
		id: string;
		mode: SkipMode;
		checkIds: string[];
		gateId: string | null;
	} | null = null;
	if (
		check?.type === "gate" &&
		(check.mode === "all-of" || check.mode === "any-of") &&
		soleEdgeTo(graph, check.id, unless.id, "exception")
	) {
		const members = membersOf(graph, check.id);
		if (members) {
			skip = {
				id: check.id,
				mode: check.mode,
				checkIds: members,
				gateId: check.id,
			};
		}
	} else if (check?.type === "rule" && memberRule(graph, check.id, unless.id)) {
		skip = { id: check.id, mode: "all-of", checkIds: [check.id], gateId: null };
	}
	if (!skip) {
		return [];
	}
	const triggerIds = triggersOf(graph, [...ruleIds, ...skip.checkIds]);
	const group: GroupCard = {
		kind: "group",
		id: unless.id,
		ruleIds,
		gateId,
		unlessId: unless.id,
		skipId: skip.id,
		triggerIds,
	};
	const skipCard: SkipCard = {
		kind: "skip",
		id: skip.id,
		mode: skip.mode,
		checkIds: skip.checkIds,
		gateId: skip.gateId,
		unlessId: unless.id,
		groupId: unless.id,
	};
	return [
		{
			card: group,
			members: gateId ? [...ruleIds, gateId] : ruleIds,
			hidden: gateId ? [...ruleIds, gateId] : ruleIds,
		},
		{
			card: skipCard,
			members: skip.gateId ? skip.checkIds : [],
			hidden: skip.gateId ? skip.checkIds : [],
		},
	];
}

function plainGroup(graph: Graph, node: WorkflowNode): Found | null {
	if (
		node.type === "rule" &&
		failsToActions(graph, node.id) &&
		incoming(graph, node.id).length > 0 &&
		incoming(graph, node.id).every((edge) => isTrigger(graph, edge.from))
	) {
		return {
			card: {
				kind: "group",
				id: node.id,
				ruleIds: [node.id],
				gateId: null,
				unlessId: null,
				skipId: null,
				triggerIds: triggersOf(graph, [node.id]),
			},
			members: [],
			hidden: [],
		};
	}
	if (
		node.type === "gate" &&
		node.mode === "all-of" &&
		failsToActions(graph, node.id)
	) {
		const members = membersOf(graph, node.id);
		if (members && members.length > 0) {
			return {
				card: {
					kind: "group",
					id: node.id,
					ruleIds: members,
					gateId: node.id,
					unlessId: null,
					skipId: null,
					triggerIds: triggersOf(graph, members),
				},
				members,
				hidden: members,
			};
		}
	}
	return null;
}

export function ruleGroupsView(graph: Graph): RuleGroupsView {
	const cards = new Map<string, RuleCard>();
	const memberOf = new Map<string, string>();
	const claim = (found: Found) => {
		cards.set(found.card.id, found.card);
		for (const id of found.hidden) {
			memberOf.set(id, found.card.id);
		}
	};
	for (const node of graph.nodes) {
		for (const found of unlessCards(graph, node)) {
			claim(found);
		}
	}
	for (const node of graph.nodes) {
		if (cards.has(node.id) || memberOf.has(node.id)) {
			continue;
		}
		const found = plainGroup(graph, node);
		if (found) {
			claim(found);
		}
	}
	const hiddenEdges = new Set<string>();
	for (const entry of graph.edges) {
		const toSoleCheck = cards.get(entry.to);
		if (
			memberOf.has(entry.from) ||
			memberOf.has(entry.to) ||
			(toSoleCheck?.kind === "skip" && isTrigger(graph, entry.from))
		) {
			hiddenEdges.add(entry.id);
		}
	}
	const viewEdges: WorkflowEdge[] = [];
	for (const card of cards.values()) {
		if (card.kind === "skip") {
			continue;
		}
		const entry = card.skipId ?? (card.gateId ? card.id : null);
		if (!entry) {
			continue;
		}
		for (const triggerId of card.triggerIds) {
			viewEdges.push({
				id: `${VIEW_EDGE_PREFIX}${triggerId}:${entry}`,
				from: triggerId,
				to: entry,
			});
		}
	}
	return { cards, memberOf, hiddenEdges, viewEdges };
}

export function isViewEdge(id: string): boolean {
	return id.startsWith(VIEW_EDGE_PREFIX);
}

export function viewGraph(graph: Graph): Graph {
	const view = ruleGroupsView(graph);
	return {
		nodes: graph.nodes.filter((node) => !view.memberOf.has(node.id)),
		edges: [
			...graph.edges.filter((edge) => !view.hiddenEdges.has(edge.id)),
			...view.viewEdges,
		],
	};
}

function withoutNodes<G extends Graph>(graph: G, ids: ReadonlySet<string>): G {
	return {
		...graph,
		nodes: graph.nodes.filter((node) => !ids.has(node.id)),
		edges: graph.edges.filter(
			(edge) => !ids.has(edge.from) && !ids.has(edge.to),
		),
	};
}

function edge(
	newId: () => string,
	from: string,
	to: string,
	extra: Pick<WorkflowEdge, "when" | "input"> = {},
): WorkflowEdge {
	const made: WorkflowEdge = { id: newId(), from, to };
	if (extra.when) {
		made.when = extra.when;
	}
	if (extra.input) {
		made.input = extra.input;
	}
	return made;
}

function entryTriggers(graph: Graph, card: GroupCard): string[] {
	if (card.triggerIds.length > 0) {
		return card.triggerIds;
	}
	return graph.nodes.flatMap((node) =>
		node.type === "trigger" ? [node.id] : [],
	);
}

export interface RuleToAdd {
	ref: string;
	config: JsonValue;
}

function ruleNode(id: string, rule: RuleToAdd): RuleNode {
	return {
		id,
		type: "rule",
		ref: rule.ref,
		config: structuredClone(rule.config),
	};
}

function groupCard<G extends Graph>(
	graph: G,
	cardId: string,
): GroupCard | null {
	const card = ruleGroupsView(graph).cards.get(cardId);
	return card?.kind === "group" ? card : null;
}

function skipCard<G extends Graph>(graph: G, cardId: string): SkipCard | null {
	const card = ruleGroupsView(graph).cards.get(cardId);
	return card?.kind === "skip" ? card : null;
}

export function addGroupRule<G extends Graph>(
	graph: G,
	cardId: string,
	rule: RuleToAdd,
	newId: () => string,
): G {
	const card = groupCard(graph, cardId);
	if (!card) {
		return graph;
	}
	const added = ruleNode(newId(), rule);
	const triggers = entryTriggers(graph, card);
	const fromTriggers = triggers.map((id) => edge(newId, id, added.id));
	if (card.gateId) {
		return {
			...graph,
			nodes: [...graph.nodes, added],
			edges: [
				...graph.edges,
				...fromTriggers,
				edge(newId, added.id, card.gateId),
			],
		};
	}
	const [only] = card.ruleIds;
	if (!only) {
		return graph;
	}
	const gate: WorkflowNode = { id: newId(), type: "gate", mode: "all-of" };
	const moved = graph.edges.map((entry) =>
		entry.from === only && !isTrigger(graph, entry.to)
			? { ...entry, from: gate.id }
			: entry,
	);
	return {
		...graph,
		nodes: [...graph.nodes, added, gate],
		edges: [
			...moved,
			...fromTriggers,
			edge(newId, only, gate.id),
			edge(newId, added.id, gate.id),
		],
	};
}

export function removeGroupRule<G extends Graph>(
	graph: G,
	cardId: string,
	ruleId: string,
): G {
	const card = groupCard(graph, cardId);
	if (!card || card.ruleIds.length < 2 || !card.ruleIds.includes(ruleId)) {
		return graph;
	}
	const without = withoutNodes(graph, new Set([ruleId]));
	const rest = card.ruleIds.filter((id) => id !== ruleId);
	const [only] = rest;
	if (rest.length > 1 || !card.gateId || !only) {
		return without;
	}
	const gateId = card.gateId;
	return {
		...without,
		nodes: without.nodes.filter((node) => node.id !== gateId),
		edges: without.edges.flatMap((entry) => {
			if (entry.from === only && entry.to === gateId) {
				return [];
			}
			return entry.from === gateId ? [{ ...entry, from: only }] : [entry];
		}),
	};
}

export function addSkipCheck<G extends Graph>(
	graph: G,
	cardId: string,
	rule: RuleToAdd,
	newId: () => string,
): G {
	const card = skipCard(graph, cardId);
	const group = card ? groupCard(graph, card.groupId) : null;
	if (!card || !group) {
		return graph;
	}
	const added = ruleNode(newId(), rule);
	const fromTriggers = entryTriggers(graph, group).map((id) =>
		edge(newId, id, added.id),
	);
	if (card.gateId) {
		return {
			...graph,
			nodes: [...graph.nodes, added],
			edges: [
				...graph.edges,
				...fromTriggers,
				edge(newId, added.id, card.gateId),
			],
		};
	}
	const gate: WorkflowNode = { id: newId(), type: "gate", mode: "all-of" };
	return {
		...graph,
		nodes: [...graph.nodes, added, gate],
		edges: [
			...graph.edges.map((entry) =>
				entry.from === card.id && entry.to === card.unlessId
					? { ...entry, from: gate.id }
					: entry,
			),
			...fromTriggers,
			edge(newId, card.id, gate.id),
			edge(newId, added.id, gate.id),
		],
	};
}

export function removeSkipCheck<G extends Graph>(
	graph: G,
	cardId: string,
	checkId: string,
	newId: () => string,
): G {
	const card = skipCard(graph, cardId);
	if (!card || !card.checkIds.includes(checkId)) {
		return graph;
	}
	if (card.gateId) {
		return withoutNodes(graph, new Set([checkId]));
	}
	const gate: WorkflowNode = { id: newId(), type: "gate", mode: "all-of" };
	const without = withoutNodes(graph, new Set([checkId]));
	return {
		...without,
		nodes: [...without.nodes, gate],
		edges: [
			...without.edges,
			edge(newId, gate.id, card.unlessId, { input: "exception" }),
		],
	};
}

export function setSkipMode<G extends Graph>(
	graph: G,
	cardId: string,
	mode: SkipMode,
): G {
	const card = skipCard(graph, cardId);
	if (!card?.gateId) {
		return graph;
	}
	return {
		...graph,
		nodes: graph.nodes.map((node) =>
			node.id === card.gateId && node.type === "gate"
				? { ...node, mode }
				: node,
		),
	};
}

export function attachSkip<G extends Graph>(
	graph: G,
	cardId: string,
	newId: () => string,
): { graph: G; skipId: string } | null {
	const card = groupCard(graph, cardId);
	if (!card || card.unlessId) {
		return null;
	}
	const unless: WorkflowNode = { id: newId(), type: "gate", mode: "unless" };
	const skip: WorkflowNode = { id: newId(), type: "gate", mode: "all-of" };
	const source = card.gateId ?? card.id;
	return {
		skipId: skip.id,
		graph: {
			...graph,
			nodes: [...graph.nodes, unless, skip],
			edges: [
				...graph.edges.map((entry) =>
					entry.from === source && !isTrigger(graph, entry.to)
						? { ...entry, from: unless.id }
						: entry,
				),
				edge(newId, source, unless.id, { input: "requirement" }),
				edge(newId, skip.id, unless.id, { input: "exception" }),
			],
		},
	};
}

export function removeSkip<G extends Graph>(graph: G, cardId: string): G {
	const card = skipCard(graph, cardId);
	const group = card ? groupCard(graph, card.groupId) : null;
	if (!card || !group) {
		return graph;
	}
	const source = group.gateId ?? group.ruleIds[0];
	if (!source) {
		return graph;
	}
	const gone = new Set([card.unlessId, card.id, ...card.checkIds]);
	const kept = withoutNodes(
		{
			...graph,
			edges: graph.edges.map((entry) =>
				entry.from === card.unlessId && !gone.has(entry.to)
					? { ...entry, from: source }
					: entry,
			),
		},
		gone,
	);
	return kept;
}

export function cardMembers(view: RuleGroupsView, cardId: string): string[] {
	const card = view.cards.get(cardId);
	if (!card) {
		return [];
	}
	if (card.kind === "skip") {
		return card.gateId ? [card.id, ...card.checkIds] : [card.id];
	}
	const skip = card.skipId ? view.cards.get(card.skipId) : undefined;
	return [
		card.id,
		...card.ruleIds,
		...(card.gateId ? [card.gateId] : []),
		...(skip?.kind === "skip" ? cardMembers(view, skip.id) : []),
	];
}

export function deleteCard<G extends Graph>(graph: G, cardId: string): G {
	const view = ruleGroupsView(graph);
	const card = view.cards.get(cardId);
	if (!card) {
		return graph;
	}
	if (card.kind === "skip") {
		return removeSkip(graph, cardId);
	}
	return withoutNodes(graph, new Set(cardMembers(view, cardId)));
}

export function connectTrigger<G extends Graph>(
	graph: G,
	triggerId: string,
	cardId: string,
	newId: () => string,
): G {
	const view = ruleGroupsView(graph);
	const card = view.cards.get(cardId);
	const group = card?.kind === "skip" ? view.cards.get(card.groupId) : card;
	if (group?.kind !== "group") {
		return graph;
	}
	const skip = group.skipId ? view.cards.get(group.skipId) : undefined;
	const targets = [
		...group.ruleIds,
		...(skip?.kind === "skip" ? skip.checkIds : []),
	];
	const missing = targets.filter(
		(id) =>
			!graph.edges.some((entry) => entry.from === triggerId && entry.to === id),
	);
	return {
		...graph,
		edges: [...graph.edges, ...missing.map((id) => edge(newId, triggerId, id))],
	};
}

export function skipLabel(names: readonly string[], mode: SkipMode): string {
	if (names.length <= 1) {
		return names[0] ?? "";
	}
	const last = names.at(-1);
	return `${names.slice(0, -1).join(", ")} ${mode === "any-of" ? "or" : "and"} ${last}`;
}
