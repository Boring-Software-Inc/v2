import { describe, expect, test } from "bun:test";
import { parseRepoRouteKey, repoRouteKey } from "#/lib/repo-route";

describe("repo route identity", () => {
	test("round-trips forge, owner and repository name", () => {
		const identity = {
			forge: "gitcafe" as const,
			owner: "boring",
			name: "scratch",
		};
		expect(repoRouteKey(identity)).toBe("gitcafe:boring:scratch");
		expect(parseRepoRouteKey(repoRouteKey(identity))).toEqual(identity);
	});

	test("leaves legacy and malformed route segments unqualified", () => {
		expect(parseRepoRouteKey("scratch")).toBeNull();
		expect(parseRepoRouteKey("unknown:boring:scratch")).toBeNull();
		expect(parseRepoRouteKey("gitcafe::scratch")).toBeNull();
		expect(parseRepoRouteKey("gitcafe:boring:scratch:extra")).toBeNull();
	});
});
