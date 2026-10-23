import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { orgRegionSchema } from "@tripwire/contracts";

const ROUTES_DIR = join(import.meta.dir, "..", "routes");
const SHELL_ROUTES = new Set(["$org.tsx", "$org.$repo.tsx", "$org.home.tsx"]);
const REGION = /staticData:\s*\{\s*region:\s*"([\w-]+)"\s*\}/;

const orgPages = readdirSync(ROUTES_DIR)
	.filter((file) => file.startsWith("$org."))
	.map((file) => ({ file, src: readFileSync(join(ROUTES_DIR, file), "utf8") }))
	.filter(({ src }) => src.includes("component:"));

describe("org page regions", () => {
	test("finds the org pages", () => {
		expect(orgPages.length).toBeGreaterThan(5);
	});

	test("every org page outside the shell declares a known region", () => {
		const missing = orgPages
			.filter(({ file }) => !SHELL_ROUTES.has(file))
			.filter(({ src }) => {
				const region = REGION.exec(src)?.[1];
				return !orgRegionSchema.safeParse(region).success;
			})
			.map(({ file }) => file);
		expect(missing).toEqual([]);
	});
});
