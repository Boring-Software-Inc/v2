/**
 * Derived PR-content metrics. Pure functions over text and diffs, so one fetch
 * of the body or the file list feeds several signals. Deterministic and dumb on
 * purpose: substring and regex counting, not a language model.
 *
 */

/** Emoji across a text: shortcodes plus one count per pictographic grapheme. */
export function countEmoji(text: string): number {
	const shortcodes = text.match(/(?<!\w):[\w+-]+:(?!\w)/g)?.length ?? 0;
	const pictographic = /\p{Extended_Pictographic}/u;
	const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
	let unicode = 0;
	for (const { segment } of segmenter.segment(text)) {
		if (pictographic.test(segment)) {
			unicode++;
		}
	}
	return shortcodes + unicode;
}

/**
 * Inline code-ish tokens. Three patterns summed independently, so a token that
 * satisfies more than one is counted more than once; only empty-paren calls
 * match.
 */
const CODE_REFERENCE_PATTERNS: readonly RegExp[] = [
	/(?:[\w@.-]+\/)+[\w.-]+\.\w{1,10}/g,
	/\w+(?:->|::)\w+\(\)/g,
	/\w{3,}\(\)/g,
];

export function countCodeReferences(text: string): number {
	return CODE_REFERENCE_PATTERNS.reduce(
		(sum, pattern) => sum + (text.match(pattern)?.length ?? 0),
		0,
	);
}

/**
 * Referenced issue numbers, deduped in first-seen order, as strings so the
 * value slots into a textList signal. Only the number survives, so a cross-repo
 * reference collapses to a bare number.
 */
const ISSUE_REFERENCE_PATTERNS: readonly RegExp[] = [
	/https?:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/(\d+)/gi,
	/(?:[\w.-]+\/[\w.-]+)#(\d+)/g,
	/GH-(\d+)/gi,
	/(?:^|[\s(])#(\d+)/gm,
];

export function extractIssueNumbers(text: string): string[] {
	const seen = new Set<string>();
	for (const pattern of ISSUE_REFERENCE_PATTERNS) {
		for (const match of text.matchAll(pattern)) {
			if (match[1]) {
				seen.add(match[1]);
			}
		}
	}
	return [...seen];
}

/** A Conventional Commits subject: type, optional scope, optional !, then text. */
const CONVENTIONAL_PATTERN = /^(\w+)(?:\([^)]+\))?!?:\s.+/;

export function isConventionalSubject(subject: string): boolean {
	return CONVENTIONAL_PATTERN.test(subject);
}

/**
 * Whether every commit subject follows Conventional Commits. Merge commits and
 * squash subjects ending in "(#123)" are excluded, since neither is authored by
 * hand. Vacuously true when there are no qualifying subjects.
 */
const SQUASH_SUFFIX = /\(#\d+\)$/;

export function allCommitsConventional(messages: readonly string[]): boolean {
	return messages
		.map((message) => message.split("\n", 1)[0] ?? "")
		.filter(
			(subject) =>
				!subject.startsWith("Merge ") && !SQUASH_SUFFIX.test(subject),
		)
		.every(isConventionalSubject);
}

/**
 * Comment-line prefixes by file extension, eight families across ~60 languages.
 * A changed line is "a comment" when its first non-whitespace token starts with
 * one of these. Facts about language syntax, rebuilt rather than copied.
 */
const COMMENT_PREFIX_FAMILIES: readonly {
	extensions: readonly string[];
	prefixes: readonly string[];
}[] = [
	{
		extensions: [
			"c",
			"cjs",
			"cpp",
			"cs",
			"css",
			"dart",
			"go",
			"h",
			"hpp",
			"java",
			"js",
			"jsx",
			"kt",
			"less",
			"mjs",
			"php",
			"proto",
			"rs",
			"scala",
			"scss",
			"swift",
			"ts",
			"tsx",
			"zig",
		],
		prefixes: ["//", "/*", "*", "{/*"],
	},
	{
		extensions: [
			"bash",
			"cmake",
			"coffee",
			"cr",
			"ex",
			"jl",
			"nim",
			"pl",
			"ps1",
			"py",
			"r",
			"rb",
			"sh",
			"tf",
			"toml",
			"yaml",
			"yml",
			"zsh",
		],
		prefixes: ["#"],
	},
	{ extensions: ["ada", "elm", "hs", "lua", "sql", "vhdl"], prefixes: ["--"] },
	{ extensions: ["htm", "html", "svg", "xml"], prefixes: ["<!--", "-->"] },
	{
		extensions: ["astro", "svelte", "vue"],
		prefixes: ["//", "/*", "*", "{/*", "<!--", "-->"],
	},
	{
		extensions: ["asm", "clj", "cljs", "el", "ini", "lisp", "rkt", "scm"],
		prefixes: [";"],
	},
	{ extensions: ["erl", "pro", "sty", "tex"], prefixes: ["%"] },
	{ extensions: ["f", "f90", "f95", "for"], prefixes: ["!"] },
];

const COMMENT_PREFIXES_BY_EXTENSION: ReadonlyMap<string, readonly string[]> =
	new Map(
		COMMENT_PREFIX_FAMILIES.flatMap((family) =>
			family.extensions.map(
				(extension) => [extension, family.prefixes] as const,
			),
		),
	);

/** Block-comment continuation lines: the opener already counted, skip these. */
const BLOCK_COMMENT_CONTINUATIONS: readonly string[] = ["*", "-->"];

function extensionOf(filename: string): string {
	const basename = filename.slice(filename.lastIndexOf("/") + 1);
	const dot = basename.lastIndexOf(".");
	return dot === -1 ? "" : basename.slice(dot + 1).toLowerCase();
}

export interface DiffFile {
	filename: string;
	status?: string;
	patch?: string;
}

/**
 * Newly added code-comment lines across the changed files. Only added ("+")
 * lines whose trimmed content starts with a comment prefix for the file's
 * language; diff headers and block-comment continuations do not count. Files
 * with no patch (binary, oversized diff) or no known extension are skipped.
 */
export function countAddedComments(files: readonly DiffFile[]): number {
	let total = 0;
	for (const file of files) {
		if (file.status === "removed" || !file.patch) {
			continue;
		}
		const prefixes = COMMENT_PREFIXES_BY_EXTENSION.get(
			extensionOf(file.filename),
		);
		if (!prefixes) {
			continue;
		}
		for (const line of file.patch.split("\n")) {
			if (!line.startsWith("+")) {
				continue;
			}
			if (
				line === "+++ /dev/null" ||
				line.startsWith("+++ a/") ||
				line.startsWith("+++ b/")
			) {
				continue;
			}
			const trimmed = line.slice(1).trim();
			if (!prefixes.some((prefix) => trimmed.startsWith(prefix))) {
				continue;
			}
			if (
				!BLOCK_COMMENT_CONTINUATIONS.some((cont) => trimmed.startsWith(cont))
			) {
				total++;
			}
		}
	}
	return total;
}

/** Distinct file extensions among the changed files, first-seen order. */
export function distinctExtensions(filenames: readonly string[]): string[] {
	const seen = new Set<string>();
	for (const filename of filenames) {
		const extension = extensionOf(filename);
		if (extension) {
			seen.add(extension);
		}
	}
	return [...seen];
}
