import { dirname, join } from "node:path";
import type { Plugin } from "vite";

const PREFIX = "\0pierre-catalog:";

const CATALOGS: Record<string, (resolved: string) => string> = {
	"shiki/langs": (resolved) =>
		`export const bundledLanguages = { typescript: () => import(${JSON.stringify(
			join(dirname(resolved), "langs/typescript.mjs"),
		)}) };`,
	"@pierre/theming/themes": (resolved) =>
		`export { pierreThemes as themes } from ${JSON.stringify(
			join(dirname(resolved), "collections/pierre.js"),
		)};`,
	"@pierre/highlights/themes/loader": () => "export const themes = {};",
};

type Resolve = (
	source: string,
	importer: string,
	options: { skipSelf: boolean },
) => Promise<{ id: string } | null>;

export function pierreCatalogs() {
	return {
		name: "tripwire:pierre-catalogs",
		enforce: "pre",
		async resolveId(
			this: { resolve: Resolve },
			source: string,
			importer: string | undefined,
		) {
			if (!importer?.includes("/@pierre/diffs/") || !(source in CATALOGS)) {
				return null;
			}
			const resolved = await this.resolve(source, importer, {
				skipSelf: true,
			});
			return resolved ? `${PREFIX}${source}\0${resolved.id}` : null;
		},
		load: (id: string) => {
			if (!id.startsWith(PREFIX)) {
				return null;
			}
			const [source = "", resolved = ""] = id.slice(PREFIX.length).split("\0");
			return CATALOGS[source]?.(resolved) ?? null;
		},
	} satisfies Plugin;
}

const PIERRE_CODE = /\/src\/components\/code\/pierre-code\.tsx$/;

export function pierreClientOnly() {
	return {
		name: "tripwire:pierre-client-only",
		enforce: "pre",
		applyToEnvironment: (environment: { name: string }) =>
			environment.name !== "client",
		load: (id: string) =>
			PIERRE_CODE.test(id)
				? "export const PierreFile = () => null;\nexport const PierreDiff = () => null;"
				: null,
	} satisfies Plugin;
}
