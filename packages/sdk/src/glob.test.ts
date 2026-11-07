import { describe, expect, test } from "bun:test";
import { globMatch } from "./glob.ts";

describe("globMatch", () => {
	describe("literal spaces in patterns stay literal (regression for the space-placeholder bug)", () => {
		test("a pattern with a space does not match a path where the space would be a wildcard", () => {
			expect(globMatch("docs/My Folder/**", "docs/MyXFolder/secret.yml")).toBe(
				false,
			);
		});

		test("a pattern with a space does not match across a path separator", () => {
			expect(globMatch("a b", "a/b")).toBe(false);
		});

		test("a pattern with a space does not match a single-character substitution", () => {
			expect(globMatch("a b", "axb")).toBe(false);
		});

		test("a pattern with a space matches the literal-space path it names", () => {
			expect(globMatch("docs/My Folder/**", "docs/My Folder/file.yml")).toBe(
				true,
			);
		});

		test("a pattern with a space matches nested paths under the literal directory", () => {
			expect(
				globMatch("docs/My Folder/**", "docs/My Folder/sub/deep/file.yml"),
			).toBe(true);
		});

		test("a pattern with a space does not match a sibling directory that shares a prefix", () => {
			expect(globMatch("docs/My Folder/**", "docs/My Folders/file.yml")).toBe(
				false,
			);
		});

		test("a bare pattern with a space matches only the exact literal string", () => {
			expect(globMatch("a b", "a b")).toBe(true);
			expect(globMatch("a b", "a  b")).toBe(false);
		});

		test("multiple spaces in a pattern are all treated literally", () => {
			expect(globMatch("a b c", "a b c")).toBe(true);
			expect(globMatch("a b c", "axbxc")).toBe(false);
			expect(globMatch("a b c", "a/b/c")).toBe(false);
		});
	});

	describe("** spans path segments", () => {
		test("matches a single segment under the prefix", () => {
			expect(globMatch("docs/**", "docs/a.yml")).toBe(true);
		});

		test("matches nested segments under the prefix", () => {
			expect(globMatch("docs/**", "docs/a/b/c.yml")).toBe(true);
		});

		test("does not match a path that does not share the prefix", () => {
			expect(globMatch("docs/**", "src/a.yml")).toBe(false);
		});

		test("does not match the prefix directory itself", () => {
			expect(globMatch("docs/**", "docs")).toBe(false);
		});

		test("** at the start matches any path", () => {
			expect(globMatch("**", "anything/at/all.yml")).toBe(true);
			expect(globMatch("**", "root.yml")).toBe(true);
		});

		test("** in the middle spans segments between literal anchors", () => {
			expect(globMatch("src/**/test.ts", "src/a/b/test.ts")).toBe(true);
			expect(globMatch("src/**/test.ts", "src/a/test.ts")).toBe(true);
			expect(globMatch("src/**/test.ts", "src/a/b/c.ts")).toBe(false);
		});
	});

	describe("* spans within a single path segment", () => {
		test("matches characters inside one segment", () => {
			expect(globMatch("docs/*.yml", "docs/a.yml")).toBe(true);
			expect(globMatch("docs/*.yml", "docs/secret.yml")).toBe(true);
		});

		test("does not span a path separator", () => {
			expect(globMatch("docs/*", "docs/a/b.yml")).toBe(false);
			expect(globMatch("docs/*.yml", "docs/sub/a.yml")).toBe(false);
		});

		test("does not match the prefix directory itself", () => {
			expect(globMatch("docs/*", "docs")).toBe(false);
		});

		test("a single segment with no wildcard matches exactly", () => {
			expect(globMatch("docs/a.yml", "docs/a.yml")).toBe(true);
			expect(globMatch("docs/a.yml", "docs/b.yml")).toBe(false);
		});
	});

	describe("regex special characters in patterns are escaped", () => {
		test("dots are literal, not any-char", () => {
			expect(globMatch("a.yml", "aXyml")).toBe(false);
			expect(globMatch("a.yml", "a.yml")).toBe(true);
		});

		test("regex metacharacters are treated literally", () => {
			expect(globMatch("a+b.c", "a+b.c")).toBe(true);
			expect(globMatch("a+b.c", "aXX.c")).toBe(false);
			expect(globMatch("(group)", "(group)")).toBe(true);
			expect(globMatch("[brackets]", "[brackets]")).toBe(true);
			expect(globMatch("a$b", "a$b")).toBe(true);
		});

		test("a literal backslash is matched, not used as an escape", () => {
			expect(globMatch("a\\b", "a\\b")).toBe(true);
		});
	});

	describe("anchoring", () => {
		test("the pattern is anchored at the start", () => {
			expect(globMatch("docs/**", "notdocs/a.yml")).toBe(false);
		});

		test("the pattern is anchored at the end", () => {
			expect(globMatch("docs/**", "docs/a.yml/extra")).toBe(true);
			expect(globMatch("docs/a.yml", "docs/a.yml/extra")).toBe(false);
		});

		test("an empty pattern matches only the empty path", () => {
			expect(globMatch("", "")).toBe(true);
			expect(globMatch("", "a")).toBe(false);
		});
	});

	describe("honeypot-style real-world patterns", () => {
		test("the shipped default matches its workflow directory", () => {
			expect(
				globMatch(".github/workflows/**", ".github/workflows/ci.yml"),
			).toBe(true);
			expect(
				globMatch(
					".github/workflows/**",
					".github/workflows/release-please.yml",
				),
			).toBe(true);
		});

		test("the shipped default does not match unrelated paths", () => {
			expect(globMatch(".github/workflows/**", "docs/readme.md")).toBe(false);
			expect(globMatch(".github/workflows/**", "src/index.ts")).toBe(false);
		});

		test("a maintainer pattern with a space names only its literal directory", () => {
			expect(globMatch("docs/My Folder/**", "docs/My Folder/secret.yml")).toBe(
				true,
			);
			expect(globMatch("docs/My Folder/**", "docs/MyXFolder/secret.yml")).toBe(
				false,
			);
			expect(globMatch("docs/My Folder/**", "docs/My Folder2/secret.yml")).toBe(
				false,
			);
		});
	});
});
