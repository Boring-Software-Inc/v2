import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pierreCatalogs } from "./pierre-catalogs";

const PIERRE_IMPORTER = fileURLToPath(import.meta.resolve("@pierre/diffs"));

const pierreRequire = createRequire(PIERRE_IMPORTER);

function packageFile(name: string, file: string): string {
	return join(dirname(pierreRequire.resolve(`${name}/package.json`)), file);
}

const context = {
	resolve: async (source: string) => {
		const ids: Record<string, string> = {
			"shiki/langs": packageFile("shiki", "dist/langs.mjs"),
			"@pierre/theming/themes": packageFile(
				"@pierre/theming",
				"dist/themes.js",
			),
			"@pierre/highlights/themes/loader": "/highlights/themes/loader.js",
		};
		return ids[source] ? { id: ids[source] } : null;
	},
};

async function catalog(source: string, importer = PIERRE_IMPORTER) {
	const plugin = pierreCatalogs();
	const id = await plugin.resolveId.call(context, source, importer);
	return id === null ? null : plugin.load(id);
}

function importedPaths(code: string): string[] {
	return [...code.matchAll(/(?:import\(|from )"([^"]+)"/g)].map(
		(match) => match[1] ?? "",
	);
}

describe("pierreCatalogs", () => {
	test("pierre loads only the typescript grammar", async () => {
		const code = (await catalog("shiki/langs")) ?? "";
		expect(code).toContain("typescript:");
		const paths = importedPaths(code);
		expect(paths).toHaveLength(1);
		expect(paths[0]).toEndWith("langs/typescript.mjs");
		expect(existsSync(paths[0] ?? "")).toBe(true);
	});

	test("pierre themes come from the pierre collection only", async () => {
		const code = (await catalog("@pierre/theming/themes")) ?? "";
		const paths = importedPaths(code);
		expect(paths).toHaveLength(1);
		expect(paths[0]).toEndWith("collections/pierre.js");
		expect(existsSync(paths[0] ?? "")).toBe(true);
		const { pierreThemes } = await import(paths[0] ?? "");
		expect(pierreThemes.hasTheme("pierre-light")).toBe(true);
		expect(pierreThemes.hasTheme("pierre-dark")).toBe(true);
	});

	test("the zed theme catalog is empty", async () => {
		expect(await catalog("@pierre/highlights/themes/loader")).toBe(
			"export const themes = {};",
		);
	});

	test("imports from outside pierre resolve as usual", async () => {
		expect(await catalog("shiki/langs", "/app/src/main.ts")).toBeNull();
		expect(await catalog("shiki/core")).toBeNull();
	});
});
