import { readFile } from "node:fs/promises";
import { Glob } from "bun";
import { z } from "zod";

const SOURCE_ROOTS = ["apps", "packages"] as const;
const UI_SDK_IMPORT = /^@ui-sdk\//;
const BASE_UI_IMPORT = /^@base-ui\/react(?:\/|$)/;
const LEGACY_UI_IMPORT =
	/^(?:#\/design-system\/(?:icon|ui|lib)(?:\/|$)|(?:#|@)\/(?:components|lib)\/(?:glaze|quartz)(?:\/|$)|(?:\.\.?\/)+(?:.*\/)?(?:glaze|quartz)(?:\/|$))/;
const MODULE_SOURCE =
	/(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;
const PRODUCT_EMPTY_STATE = "apps/web/src/components/common/empty-state.tsx";
const MINIGAME_HOST = "apps/web/src/components/not-found.tsx";

interface Violation {
	file: string;
	message: string;
}

function normalized(path: string) {
	return path.replaceAll("\\", "/");
}

function isUiImplementation(file: string) {
	return normalized(file).startsWith("packages/ui/src/");
}

function moduleSources(source: string) {
	return [...source.matchAll(MODULE_SOURCE)]
		.map((match) => match[1] ?? match[2])
		.filter((value): value is string => value !== undefined);
}

const dependencySectionSchema = z.record(z.string(), z.string()).optional();
const packageManifestSchema = z.object({
	dependencies: dependencySectionSchema,
	devDependencies: dependencySectionSchema,
	peerDependencies: dependencySectionSchema,
	optionalDependencies: dependencySectionSchema,
});

const violations: Violation[] = [];

for (const root of SOURCE_ROOTS) {
	const glob = new Glob(`${root}/*/src/**/*.{ts,tsx}`);
	for await (const file of glob.scan({ cwd: process.cwd(), absolute: false })) {
		if (file.includes("routeTree.gen.ts")) {
			continue;
		}
		const source = await Bun.file(file).text();
		if (
			file.startsWith("apps/web/src/") &&
			/<textarea(?:\s|\/?>)/.test(source)
		) {
			violations.push({
				file,
				message:
					"use Textarea from @tripwire/ui/field so multiline shape stays owned by the design system",
			});
		}
		if (
			file !== PRODUCT_EMPTY_STATE &&
			moduleSources(source).includes("@tripwire/ui/empty-state")
		) {
			violations.push({
				file,
				message: `product empty states must import ${PRODUCT_EMPTY_STATE}`,
			});
		}
		if (
			file !== MINIGAME_HOST &&
			/<MascotArt\b[^>]*\bminigame(?:\s|=|\/|>)/m.test(source)
		) {
			violations.push({
				file,
				message: "the mascot runner minigame is reserved for the 404 surface",
			});
		}
		for (const imported of moduleSources(source)) {
			if (
				file.startsWith("apps/web/src/routes/") &&
				!file.endsWith("/__root.tsx") &&
				imported.startsWith("@tripwire/ui/")
			) {
				violations.push({
					file,
					message:
						"compose @tripwire/ui in a page component; routes own loading, guards, and SEO",
				});
			}
			if (UI_SDK_IMPORT.test(imported) && !isUiImplementation(file)) {
				violations.push({
					file,
					message: `${imported} is private to packages/ui/src`,
				});
			}
			if (BASE_UI_IMPORT.test(imported)) {
				violations.push({
					file,
					message: `${imported} must be replaced by @tripwire/ui`,
				});
			}
			if (LEGACY_UI_IMPORT.test(imported)) {
				violations.push({
					file,
					message: `${imported} is a removed design-system implementation path`,
				});
			}
		}
	}
}

for (const root of SOURCE_ROOTS) {
	const glob = new Glob(`${root}/*/package.json`);
	for await (const file of glob.scan({ cwd: process.cwd(), absolute: false })) {
		const parsed = packageManifestSchema.safeParse(
			JSON.parse(await readFile(file, "utf8")),
		);
		if (!parsed.success) {
			violations.push({
				file,
				message: "invalid package dependency declarations",
			});
			continue;
		}
		const manifest = parsed.data;
		const dependencyNames = [
			manifest.dependencies,
			manifest.devDependencies,
			manifest.peerDependencies,
			manifest.optionalDependencies,
		].flatMap((section) => Object.keys(section ?? {}));
		for (const dependency of dependencyNames) {
			if (
				UI_SDK_IMPORT.test(dependency) &&
				file !== "packages/ui/package.json"
			) {
				violations.push({
					file,
					message: `${dependency} may only be declared by packages/ui`,
				});
			}
			if (BASE_UI_IMPORT.test(dependency)) {
				violations.push({
					file,
					message: `${dependency} must be removed after the ui-sdk migration`,
				});
			}
		}
	}
}

if (violations.length > 0) {
	console.error(
		`ui boundary check failed with ${violations.length} violation(s):`,
	);
	for (const violation of violations) {
		console.error(`  ${violation.file}: ${violation.message}`);
	}
	process.exit(1);
}

console.log("ui boundary check passed");
