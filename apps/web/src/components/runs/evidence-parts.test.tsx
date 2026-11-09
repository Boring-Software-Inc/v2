import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	blobUrl,
	CryptoMatches,
	FileIcon,
	FilePath,
	FileRows,
	renderBackticks,
} from "#/components/runs/evidence-parts";

async function elements(html: string, selector: string) {
	const found: {
		tag: string;
		href: string | null;
		target: string | null;
		rel: string | null;
		label: string | null;
		hidden: string | null;
	}[] = [];
	await new HTMLRewriter()
		.on(selector, {
			element(element) {
				found.push({
					tag: element.tagName,
					href: element.getAttribute("href"),
					target: element.getAttribute("target"),
					rel: element.getAttribute("rel"),
					label: element.getAttribute("aria-label"),
					hidden: element.getAttribute("aria-hidden"),
				});
			},
		})
		.transform(new Response(html))
		.text();
	return found;
}

describe("evidence-parts", () => {
	test("backticks preserve the existing split grammar and escape native code children", async () => {
		const html = renderToStaticMarkup(
			<p>
				{renderBackticks("before `<b>literal</b>` middle `Ωmega` after `")}
			</p>,
		);
		expect((await elements(html, "p > code")).map((node) => node.tag)).toEqual([
			"code",
			"code",
		]);
		expect(html).toContain("&lt;b&gt;literal&lt;/b&gt;</code> middle ");
		expect(html).toContain("Ωmega</code> after `</p>");
		expect(await elements(html, "b")).toEqual([]);
		expect(renderBackticks("``")).toEqual(["``"]);
		expect(renderBackticks("")).toEqual([""]);
		expect(
			renderToStaticMarkup(<>{renderBackticks("`one\ntwo`")}</>),
		).toContain("one\ntwo</code>");
	});

	test("FilePath retains the inline span split at the last slash", async () => {
		for (const file of ["README.md", "a/b/<b>Ωmega-مرحبا</b>.ts", "dir/", ""]) {
			const html = renderToStaticMarkup(<FilePath file={file} />);
			expect((await elements(html, "span")).map((node) => node.tag)).toEqual([
				"span",
				"span",
				"span",
			]);
			expect(await elements(html, "a, b")).toEqual([]);
		}
		const trailing = renderToStaticMarkup(<FilePath file="dir/" />);
		expect(trailing).toContain("dir/</span>");
		const escaped = renderToStaticMarkup(<FilePath file="a/b/<literal>.ts" />);
		expect(escaped).toContain("a/b/</span>");
		expect(escaped).toContain("&lt;literal&gt;.ts</span>");
	});

	test("FileIcon remains a decorative 14px native SVG", async () => {
		const html = renderToStaticMarkup(<FileIcon />);
		expect((await elements(html, "svg")).map((node) => node.hidden)).toEqual([
			"true",
		]);
		expect(html).toContain('width="14"');
		expect(html).toContain('height="14"');
		expect(html).toContain('focusable="false"');
	});

	test("blobUrl preserves falsy sha and literal hostile path/line behavior", () => {
		expect(blobUrl("local/ui", null, "file")).toBeNull();
		expect(blobUrl("local/ui", "", "file")).toBeNull();
		expect(blobUrl("o/r?raw", "sha/#", "../<b>مرحبا?x&y", 0)).toBe(
			"https://github.com/o/r?raw/blob/sha/#/../<b>مرحبا?x&y",
		);
		expect(blobUrl("o/r", "sha", "dir/file", -2)).toBe(
			"https://github.com/o/r/blob/sha/dir/file#L-2",
		);
		expect(blobUrl("o/r", "sha", "dir/file", 12)).toBe(
			"https://github.com/o/r/blob/sha/dir/file#L12",
		);
	});

	test("FileRows preserves named native list, input order, and external anchor attributes", async () => {
		const files = ["a/file.ts", "Ωmega-مرحبا.md"];
		const html = renderToStaticMarkup(
			<FileRows files={files} repo="local/ui" sha="local-sha" />,
		);
		expect((await elements(html, "ul")).map((node) => node.label)).toEqual([
			"Protected files touched",
		]);
		expect((await elements(html, "ul > li")).map((node) => node.tag)).toEqual([
			"li",
			"li",
		]);
		expect((await elements(html, "li > a")).map((node) => node.href)).toEqual(
			files.map((file) => `https://github.com/local/ui/blob/local-sha/${file}`),
		);
		expect(
			(await elements(html, "a")).map(({ target, rel }) => ({ target, rel })),
		).toEqual([
			{ target: "_blank", rel: "noreferrer" },
			{ target: "_blank", rel: "noreferrer" },
		]);
		expect(await elements(html, "literal")).toEqual([]);
		for (const sha of [null, ""]) {
			const unlinked = renderToStaticMarkup(
				<FileRows files={files} repo="local/ui" sha={sha} />,
			);
			expect(await elements(unlinked, "a")).toEqual([]);
			expect(await elements(unlinked, "ul > li")).toHaveLength(2);
		}
		expect(
			await elements(
				renderToStaticMarkup(
					<FileRows files={[]} repo="local/ui" sha={null} />,
				),
				"li",
			),
		).toEqual([]);
	});

	test("CryptoMatches preserves value/location order, literal text, caption span, and empty list", async () => {
		const html = renderToStaticMarkup(
			<CryptoMatches
				matches={[
					{ value: "0x1234<literal>", location: "src/Ωmega.ts:0" },
					{ value: "second", location: "body" },
				]}
			/>,
		);
		expect((await elements(html, "ul")).map((node) => node.label)).toEqual([
			"Matched addresses",
		]);
		expect(await elements(html, "ul > li")).toHaveLength(2);
		expect(await elements(html, "li > span")).toHaveLength(4);
		expect(await elements(html, "li > span > span")).toHaveLength(2);
		expect(html).toContain("0x1234&lt;literal&gt;</span>");
		expect(html).toContain('in <span class="mono">src/Ωmega.ts:0</span>');
		expect(html.indexOf("0x1234")).toBeLessThan(html.indexOf("src/Ωmega"));
		expect(html.indexOf("src/Ωmega")).toBeLessThan(html.indexOf("second"));
		expect(await elements(html, "literal")).toEqual([]);
		const empty = renderToStaticMarkup(<CryptoMatches matches={[]} />);
		expect((await elements(empty, "ul")).map((node) => node.label)).toEqual([
			"Matched addresses",
		]);
		expect(await elements(empty, "li")).toEqual([]);
	});
});
