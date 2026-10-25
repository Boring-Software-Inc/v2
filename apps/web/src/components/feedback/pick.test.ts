import { describe, expect, test } from "bun:test";
import {
	domPath,
	nameOf,
	type PickNode,
	resolvePick,
	snippet,
	summarize,
	trailOf,
} from "./pick";

function node(
	tagName: string,
	attrs: Record<string, string> = {},
	parent: PickNode | null = null,
	id = "",
): PickNode {
	return {
		tagName: tagName.toUpperCase(),
		id,
		parentElement: parent,
		getAttribute: (name) => attrs[name] ?? null,
	};
}

const html = node("html");
const body = node("body", {}, html);
const main = node("main", {}, body, "main-content");
const section = node("section", { "data-feedback-name": "RulesList" }, main);
const card = node(
	"div",
	{ "data-slot": "card", "data-feedback-name": "RuleCard" },
	section,
);
const panel = node("div", { "data-slot": "card-panel" }, card);
const heading = node("h2", {}, panel);

describe("resolvePick", () => {
	test("climbs to the nearest named component", () => {
		const target = resolvePick(heading);
		expect(target?.node).toBe(card);
		expect(target?.name).toBe("RuleCard");
	});

	test("falls back to the nearest Glaze slot when nothing is named", () => {
		const table = node("table", { "data-slot": "table" }, main);
		const row = node("tr", { "data-slot": "table-row" }, table);
		const cell = node("span", {}, row);
		const target = resolvePick(cell);
		expect(target?.node).toBe(row);
		expect(target?.name).toBe("TableRow");
	});

	test("falls back to the tag name", () => {
		const plain = node("p", {}, main);
		expect(resolvePick(plain)?.name).toBe("p");
	});

	test("ignores the feedback chrome and the page root", () => {
		const chrome = node("div", { "data-feedback-chrome": "" }, body);
		const inner = node("span", {}, chrome);
		expect(resolvePick(inner)).toBeNull();
		expect(resolvePick(body)).toBeNull();
		expect(resolvePick(null)).toBeNull();
	});
});

describe("summary", () => {
	test("nameOf turns a slot into a component name", () => {
		expect(nameOf(node("div", { "data-slot": "dialog-footer" }))).toBe(
			"DialogFooter",
		);
	});

	test("trailOf lists named ancestors outermost first", () => {
		expect(trailOf(heading)).toEqual(["RulesList", "RuleCard"]);
	});

	test("domPath stops at the nearest id", () => {
		expect(domPath(heading)).toBe(
			'main#main-content > section[data-feedback-name="RulesList"] > div[data-feedback-name="RuleCard"] > div[data-slot="card-panel"] > h2',
		);
	});

	test("snippet collapses whitespace and caps the length", () => {
		expect(snippet("  Crypto   address\n\n Catches  ")).toBe(
			"Crypto address Catches",
		);
		expect(snippet("   ")).toBeNull();
		const long = snippet("a".repeat(400));
		expect(long?.length).toBe(160);
		expect(long?.endsWith("...")).toBe(true);
	});

	test("summarize drops text inside a masked region", () => {
		const masked = node("div", { "data-privacy": "masked" }, main);
		const secret = node("div", { "data-feedback-name": "TokenRow" }, masked);
		const target = resolvePick(secret);
		if (!target) {
			throw new Error("expected a target");
		}
		expect(summarize(target, "ghp_secret").text).toBeNull();
	});

	test("summarize carries name, trail, path and text", () => {
		const target = resolvePick(heading);
		if (!target) {
			throw new Error("expected a target");
		}
		expect(summarize(target, "Crypto address")).toEqual({
			name: "RuleCard",
			trail: ["RulesList", "RuleCard"],
			path: 'main#main-content > section[data-feedback-name="RulesList"] > div[data-feedback-name="RuleCard"]',
			text: "Crypto address",
		});
	});
});
