import { describe, expect, test } from "bun:test";
import {
	changeRequestUrl,
	forgeConnectable,
	forgeSignIn,
	LIVE_FORGE_LABELS,
	SIGN_IN_FORGE_IDS,
} from "./forges.ts";

describe("changeRequestUrl", () => {
	test("github uses /pull/ and open-git uses /pulls/", () => {
		expect(
			changeRequestUrl({
				forge: "github",
				repoFullName: "acme/api",
				number: 7,
			}),
		).toBe("https://github.com/acme/api/pull/7");
		expect(
			changeRequestUrl({
				forge: "opengit",
				repoFullName: "acme/api",
				number: 7,
			}),
		).toBe("https://open-git.com/acme/api/pulls/7");
	});

	test("a self-hosted origin replaces the public host", () => {
		expect(
			changeRequestUrl({
				forge: "opengit",
				repoFullName: "acme/api",
				number: 7,
				origin: "https://git.internal/",
			}),
		).toBe("https://git.internal/acme/api/pulls/7");
	});

	test("no change request means no link", () => {
		expect(
			changeRequestUrl({
				forge: "github",
				repoFullName: "acme/api",
				number: null,
			}),
		).toBeNull();
	});
});

describe("paused forges", () => {
	test("open-git stays ingestible but cannot be connected or signed into", () => {
		expect(forgeConnectable("github")).toBe(true);
		expect(forgeConnectable("opengit")).toBe(false);
		expect(forgeSignIn("opengit")).toBeNull();
		expect(SIGN_IN_FORGE_IDS).toEqual(["github"]);
		expect(LIVE_FORGE_LABELS).toEqual(["GitHub"]);
	});
});

test("GitCafe has a distinct canonical origin and stays disabled", async () => {
	const {
		DEFAULT_FORGE_ORIGIN,
		forgeIdSchema,
		forgeSchema,
		forgePostsReviews,
	} = await import("./forges.ts");
	expect(forgeIdSchema.parse("gitcafe")).toBe("gitcafe");
	expect(forgeSchema.safeParse("gitcafe").success).toBe(false);
	expect(forgeSignIn("gitcafe")).toBeNull();
	expect(forgeConnectable("gitcafe")).toBe(false);
	expect(forgePostsReviews("gitcafe")).toBe(false);
	expect(DEFAULT_FORGE_ORIGIN.gitcafe).toBe("https://git.cafe");
	expect(DEFAULT_FORGE_ORIGIN.opengit).toBe("https://open-git.com");
	expect(
		changeRequestUrl({
			forge: "gitcafe",
			repoFullName: "owner/repo",
			number: 7,
		}),
	).toBe("https://git.cafe/owner/repo/pulls/7");
});
