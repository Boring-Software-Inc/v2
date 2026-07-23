import { describe, expect, test } from "bun:test";
import {
	allCommitsConventional,
	countAddedComments,
	countCodeReferences,
	countEmoji,
	distinctExtensions,
	extractIssueNumbers,
	isConventionalSubject,
} from "./pr-metrics.ts";

describe("countEmoji", () => {
	test("counts unicode pictographs and shortcodes", () => {
		expect(countEmoji("ship it 🚀 :tada:")).toBe(2);
	});

	test("a multi-codepoint emoji counts once", () => {
		// Family emoji is several code points joined by ZWJ; one visible glyph.
		expect(countEmoji("👨‍👩‍👧‍👦")).toBe(1);
	});

	test("plain text has none", () => {
		expect(countEmoji("just a normal title")).toBe(0);
	});

	test("shortcode must not touch a word char", () => {
		expect(countEmoji("http://a:b:c")).toBe(0);
		expect(countEmoji(":+1:")).toBe(1);
	});
});

describe("countCodeReferences", () => {
	test("paths, method calls and function calls sum, with the documented double-count", () => {
		// src/foo/bar.ts (path) + Foo::bar() (method AND function pattern) + run().
		expect(
			countCodeReferences("see src/foo/bar.ts and Foo::bar() and run()"),
		).toBe(4);
	});

	test("only empty-paren calls match", () => {
		expect(countCodeReferences("call foo(1, 2)")).toBe(0);
	});

	test("plain prose is zero", () => {
		expect(countCodeReferences("this pull request fixes a bug")).toBe(0);
	});
});

describe("extractIssueNumbers", () => {
	test("parses every reference shape, deduped", () => {
		const text =
			"closes #12, see owner/repo#34, GH-56, https://github.com/a/b/issues/78 and #12 again";
		expect(extractIssueNumbers(text)).toEqual(["78", "34", "56", "12"]);
	});

	test("no references yields an empty list", () => {
		expect(extractIssueNumbers("nothing here")).toEqual([]);
	});
});

describe("conventional subjects", () => {
	test("recognizes type, scope and bang", () => {
		expect(isConventionalSubject("feat(api)!: add thing")).toBe(true);
		expect(isConventionalSubject("just some words")).toBe(false);
	});

	test("all-commits ignores merge and squash subjects", () => {
		expect(
			allCommitsConventional([
				"feat: a",
				"Merge branch 'main'",
				"random squash (#42)",
			]),
		).toBe(true);
	});

	test("one non-conventional subject fails the set", () => {
		expect(allCommitsConventional(["feat: a", "oops did a thing"])).toBe(false);
	});

	test("no qualifying subjects is vacuously true", () => {
		expect(allCommitsConventional([])).toBe(true);
	});
});

describe("countAddedComments", () => {
	test("counts added comment lines by language, once per block", () => {
		const files = [
			{
				filename: "src/a.ts",
				status: "modified",
				patch: [
					"+++ b/src/a.ts",
					"+// a line comment",
					"+const x = 1;",
					"+/* block opens",
					"+ * continuation",
					"+ */",
				].join("\n"),
			},
			{
				filename: "script.py",
				status: "modified",
				patch: ["+# python comment", "+x = 1"].join("\n"),
			},
		];
		// ts: line comment + block opener (continuation "*" skipped). py: one.
		expect(countAddedComments(files)).toBe(3);
	});

	test("removed files, binary patches and unknown extensions are skipped", () => {
		const files = [
			{ filename: "old.ts", status: "removed", patch: "+// gone" },
			{ filename: "image.png", status: "added" },
			{ filename: "data.unknownext", status: "added", patch: "+// nope" },
		];
		expect(countAddedComments(files)).toBe(0);
	});
});

describe("distinctExtensions", () => {
	test("dedups and lowercases, ignores extensionless", () => {
		expect(
			distinctExtensions(["src/a.TS", "src/b.ts", "Makefile", "docs/c.md"]),
		).toEqual(["ts", "md"]);
	});
});
