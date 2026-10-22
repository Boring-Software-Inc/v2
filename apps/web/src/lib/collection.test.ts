import { describe, expect, test } from "bun:test";
import {
	applyCollection,
	type CollectionState,
	collectionSearchSchema,
	decodeCollectionState,
	defineCollection,
	EMPTY_COLLECTION_STATE,
	encodeCollectionState,
	isFiltered,
	matchesSearch,
	mergeCollectionParams,
	readCollectionParams,
	writeCollectionParams,
} from "./collection";

interface Pet {
	name: string;
	kind: "cat" | "dog" | "fish";
	tags: string[];
	age: number;
	adopted: boolean;
}

const PETS: Pet[] = [
	{ name: "Miso", kind: "cat", tags: ["calm"], age: 4, adopted: true },
	{ name: "Bean", kind: "dog", tags: ["loud", "calm"], age: 2, adopted: false },
	{ name: "Nori", kind: "cat", tags: ["loud"], age: 7, adopted: false },
	{ name: "Bubbles", kind: "fish", tags: [], age: 1, adopted: true },
];

const PETS_COLLECTION = defineCollection<Pet>({
	id: "pets",
	noun: "pets",
	search: { fields: (pet) => [pet.name, pet.kind, null] },
	filters: [
		{
			key: "status",
			label: "Status",
			kind: "segment",
			allLabel: "All",
			options: [
				{ value: "adopted", label: "Adopted", match: (pet) => pet.adopted },
				{ value: "waiting", label: "Waiting", match: (pet) => !pet.adopted },
			],
		},
		{
			key: "kind",
			label: "Kind",
			kind: "select",
			value: (pet) => pet.kind,
			optionsFrom: (rows) =>
				[...new Set(rows.map((pet) => pet.kind))].map((kind) => ({
					value: kind,
					label: kind,
				})),
		},
		{
			key: "tag",
			label: "Tag",
			kind: "multi",
			value: (pet) => pet.tags,
			options: [
				{ value: "calm", label: "Calm" },
				{ value: "loud", label: "Loud" },
			],
		},
		{
			key: "young",
			label: "Young",
			kind: "toggle",
			match: (pet) => pet.age < 3,
		},
	],
	sort: [
		{
			key: "name",
			label: "Name",
			compare: (a, b) => a.name.localeCompare(b.name),
		},
		{ key: "age", label: "Oldest", compare: (a, b) => b.age - a.age },
	],
	defaultSort: "name",
});

const state = (patch: Partial<CollectionState>): CollectionState => ({
	...EMPTY_COLLECTION_STATE,
	...patch,
});

const names = (rows: Pet[]) => rows.map((pet) => pet.name);

describe("matchesSearch", () => {
	test("matches every term anywhere in the fields, ignoring case", () => {
		expect(matchesSearch(PETS_COLLECTION, PETS[0], "MISO cat")).toBe(true);
		expect(matchesSearch(PETS_COLLECTION, PETS[0], "miso dog")).toBe(false);
	});

	test("an empty query matches", () => {
		expect(matchesSearch(PETS_COLLECTION, PETS[0], "   ")).toBe(true);
	});
});

describe("applyCollection", () => {
	test("sorts by the default sort with nothing set", () => {
		const result = applyCollection(
			PETS_COLLECTION,
			PETS,
			EMPTY_COLLECTION_STATE,
		);
		expect(names(result.rows)).toEqual(["Bean", "Bubbles", "Miso", "Nori"]);
		expect(result.total).toBe(4);
		expect(result.filtered).toBe(false);
	});

	test("sorts by the chosen sort and falls back on an unknown one", () => {
		expect(
			names(
				applyCollection(PETS_COLLECTION, PETS, state({ sort: "age" })).rows,
			),
		).toEqual(["Nori", "Miso", "Bean", "Bubbles"]);
		expect(
			names(
				applyCollection(PETS_COLLECTION, PETS, state({ sort: "nope" })).rows,
			),
		).toEqual(["Bean", "Bubbles", "Miso", "Nori"]);
	});

	test("does not reorder the input rows", () => {
		const input = [...PETS];
		applyCollection(PETS_COLLECTION, input, state({ sort: "age" }));
		expect(input).toEqual(PETS);
	});

	test("filters by search", () => {
		const result = applyCollection(PETS_COLLECTION, PETS, state({ q: "cat" }));
		expect(names(result.rows)).toEqual(["Miso", "Nori"]);
		expect(result.filtered).toBe(true);
	});

	test("an option match predicate filters", () => {
		const result = applyCollection(
			PETS_COLLECTION,
			PETS,
			state({ filters: { status: ["adopted"] } }),
		);
		expect(names(result.rows)).toEqual(["Bubbles", "Miso"]);
	});

	test("a value field filters, and a multi filter ORs its values", () => {
		const result = applyCollection(
			PETS_COLLECTION,
			PETS,
			state({ filters: { tag: ["calm", "loud"] } }),
		);
		expect(names(result.rows)).toEqual(["Bean", "Miso", "Nori"]);
	});

	test("separate filters AND together", () => {
		const result = applyCollection(
			PETS_COLLECTION,
			PETS,
			state({ filters: { kind: ["cat"], tag: ["loud"] } }),
		);
		expect(names(result.rows)).toEqual(["Nori"]);
	});

	test("a toggle filters only when on", () => {
		expect(
			names(
				applyCollection(
					PETS_COLLECTION,
					PETS,
					state({ filters: { young: ["on"] } }),
				).rows,
			),
		).toEqual(["Bean", "Bubbles"]);
		expect(
			applyCollection(PETS_COLLECTION, PETS, state({ filters: { young: [] } }))
				.rows,
		).toHaveLength(4);
	});

	test("an unknown value matches nothing", () => {
		const result = applyCollection(
			PETS_COLLECTION,
			PETS,
			state({ filters: { status: ["lost"] } }),
		);
		expect(result.rows).toHaveLength(0);
		expect(result.filtered).toBe(true);
	});

	test("counts each option against the search and the other filters, not its own", () => {
		const result = applyCollection(
			PETS_COLLECTION,
			PETS,
			state({ q: "b", filters: { status: ["waiting"] } }),
		);
		expect(names(result.rows)).toEqual(["Bean"]);
		expect(result.counts.status).toEqual({ adopted: 1, waiting: 1 });
		expect(result.allCounts.status).toBe(2);
		expect(result.counts.kind).toEqual({ dog: 1 });
		expect(result.counts.tag).toEqual({ calm: 1, loud: 1 });
		expect(result.counts.young).toEqual({ on: 1 });
	});

	test("derives options from every row, not the visible ones", () => {
		const result = applyCollection(
			PETS_COLLECTION,
			PETS,
			state({ filters: { kind: ["fish"] } }),
		);
		expect(result.options.kind?.map((option) => option.value)).toEqual([
			"cat",
			"dog",
			"fish",
		]);
		expect(result.counts.kind).toEqual({ cat: 2, dog: 1, fish: 1 });
	});
});

describe("defaults", () => {
	const INVITES = defineCollection<Pet>({
		id: "invites",
		noun: "pets",
		filters: [
			{
				key: "status",
				label: "Status",
				kind: "segment",
				defaultValue: "waiting",
				options: [
					{ value: "adopted", label: "Adopted", match: (pet) => pet.adopted },
					{ value: "waiting", label: "Waiting", match: (pet) => !pet.adopted },
				],
			},
		],
	});

	test("a default value filters while nothing is set", () => {
		const result = applyCollection(INVITES, PETS, EMPTY_COLLECTION_STATE);
		expect(names(result.rows)).toEqual(["Bean", "Nori"]);
		expect(result.filtered).toBe(false);
	});

	test("choosing another value counts as filtered", () => {
		expect(
			isFiltered(INVITES, state({ filters: { status: ["adopted"] } })),
		).toBe(true);
		expect(
			isFiltered(INVITES, state({ filters: { status: ["waiting"] } })),
		).toBe(false);
	});

	test("the default stays out of the URL", () => {
		expect(
			encodeCollectionState(
				INVITES,
				state({ filters: { status: ["waiting"] } }),
			).status,
		).toBeUndefined();
		expect(
			encodeCollectionState(
				INVITES,
				state({ filters: { status: ["adopted"] } }),
			).status,
		).toBe("adopted");
	});
});

describe("URL state", () => {
	test("round-trips through the search params", () => {
		const original = state({
			q: "miso",
			sort: "age",
			filters: {
				status: ["adopted"],
				kind: ["cat"],
				tag: ["calm"],
				young: ["on"],
			},
		});
		const search = encodeCollectionState(PETS_COLLECTION, original);
		expect(search).toEqual({
			q: "miso",
			sort: "age",
			status: "adopted",
			kind: "cat",
			tag: ["calm"],
			young: true,
		});
		const parsed = collectionSearchSchema(PETS_COLLECTION).parse(search);
		expect(decodeCollectionState(PETS_COLLECTION, parsed)).toEqual(original);
	});

	test("drops empty values and the default sort", () => {
		expect(
			encodeCollectionState(PETS_COLLECTION, state({ sort: "name" })),
		).toEqual({
			q: undefined,
			sort: undefined,
			status: undefined,
			kind: undefined,
			tag: undefined,
			young: undefined,
		});
	});

	test("the schema throws out values of the wrong shape", () => {
		const parsed = collectionSearchSchema(PETS_COLLECTION).parse({
			q: 4,
			tag: "calm",
			young: "yes",
			status: "adopted",
			other: "kept out",
		});
		expect(parsed).toEqual({ status: "adopted" });
	});
});

describe("collection params", () => {
	const params = { status: "pets" };

	test("reads only the renamed keys", () => {
		expect(
			readCollectionParams(
				{ pets: "adopted", status: "waiting", q: "x" },
				params,
			),
		).toEqual({ status: "adopted" });
	});

	test("writes only the renamed keys", () => {
		const encoded = encodeCollectionState(PETS_COLLECTION, {
			q: "miso",
			sort: undefined,
			filters: { status: ["waiting"], kind: ["cat"] },
		});
		expect(writeCollectionParams(encoded, params)).toEqual({ pets: "waiting" });
	});

	test("round trips a renamed filter", () => {
		const state: CollectionState = {
			q: "",
			sort: undefined,
			filters: { status: ["adopted"] },
		};
		const written = writeCollectionParams(
			encodeCollectionState(PETS_COLLECTION, state),
			params,
		);
		const read = decodeCollectionState(
			PETS_COLLECTION,
			readCollectionParams(written, params),
		);
		expect(read.filters).toEqual({ status: ["adopted"] });
	});

	test("merging keeps local state and resets a cleared URL key", () => {
		const local: CollectionState = {
			q: "miso",
			sort: undefined,
			filters: { status: ["adopted"], kind: ["cat"] },
		};
		expect(
			mergeCollectionParams(local, EMPTY_COLLECTION_STATE, params),
		).toEqual({ q: "miso", sort: undefined, filters: { kind: ["cat"] } });
	});

	test("without params the search passes through", () => {
		expect(readCollectionParams({ q: "x" }, undefined)).toEqual({ q: "x" });
		expect(writeCollectionParams({ q: "x" }, undefined)).toEqual({ q: "x" });
	});
});
