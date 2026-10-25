import { describe, expect, test } from "bun:test";
import { FORGE_GRID } from "#/components/forges/forge-cell";
import { SUPPORTED_FORGES_ANSWER } from "#/lib/forge-copy";
import { connectForges, signInForges } from "#/lib/forge-grid";

const ids = (forges: readonly { id: string }[]) => forges.map((f) => f.id);

describe("sign-in grid", () => {
	test("shows only forges you can sign in with", () => {
		expect(ids(signInForges())).toEqual(["github"]);
	});
});

describe("connect grid", () => {
	test("shows only forges that can be connected", () => {
		expect(ids(connectForges(() => true))).toEqual(["github"]);
	});

	test("hides a connectable forge with no connect flow", () => {
		expect(ids(connectForges((id) => id !== "github"))).toEqual([]);
	});

	test("never shows paused or planned forges", () => {
		const shown = ids(connectForges(() => true));
		expect(shown).not.toContain("opengit");
		expect(shown).not.toContain("gitlab");
		expect(shown).not.toContain("origin");
	});
});

describe("grid layout", () => {
	test("an odd last cell spans the full row", () => {
		expect(FORGE_GRID).toContain("[&>*:last-child:nth-child(odd)]:col-span-2");
	});
});

describe("supported forges answer", () => {
	test("states only what works", () => {
		expect(SUPPORTED_FORGES_ANSWER).toBe(
			"Tripwire watches repos on GitHub. You sign in with GitHub.",
		);
		expect(SUPPORTED_FORGES_ANSWER).not.toMatch(/yet|soon|today/i);
	});
});
