import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	findProjectLink,
	linkedWorkflowFile,
	PROJECT_LINK_PATH,
	removeProjectLink,
	resolveOrg,
	resolveRepo,
	writeProjectLink,
} from "#/project-link";

let root: string;

beforeEach(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "tripwire-link-")));
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("finding the project link", () => {
	test("the link lives at .tripwire/project.json", () => {
		expect(PROJECT_LINK_PATH).toBe(join(".tripwire", "project.json"));
	});

	test("a link in the start directory is found", () => {
		const path = writeProjectLink(root, { org: "acme", repo: "scratch" });
		expect(path).toBe(join(root, ".tripwire", "project.json"));
		expect(findProjectLink(root)).toEqual({
			path,
			link: { org: "acme", repo: "scratch" },
		});
	});

	test("a link in a parent directory is found from a nested one", () => {
		const path = writeProjectLink(root, { repo: "acme/scratch" });
		const nested = join(root, "src", "deep", "er");
		mkdirSync(nested, { recursive: true });
		expect(findProjectLink(nested)).toEqual({
			path,
			link: { repo: "acme/scratch" },
		});
	});

	test("the nearest link wins over one further up", () => {
		writeProjectLink(root, { repo: "outer" });
		const inner = join(root, "packages", "app");
		mkdirSync(inner, { recursive: true });
		const path = writeProjectLink(inner, { repo: "inner" });
		expect(findProjectLink(join(inner))).toEqual({
			path,
			link: { repo: "inner" },
		});
	});

	test("no link anywhere up the tree is null", () => {
		const nested = join(root, "a", "b");
		mkdirSync(nested, { recursive: true });
		expect(findProjectLink(nested, root)).toBeNull();
	});

	test("a link that is not valid says where it is and how to fix it", () => {
		mkdirSync(join(root, ".tripwire"));
		writeFileSync(join(root, PROJECT_LINK_PATH), '{"repo": 3}');
		expect(() => findProjectLink(root)).toThrow(
			`${join(root, PROJECT_LINK_PATH)} is not a valid Tripwire link. Run tripwire link <repo> to rewrite it.`,
		);
		writeFileSync(join(root, PROJECT_LINK_PATH), "not json");
		expect(() => findProjectLink(root)).toThrow("is not a valid Tripwire link");
	});

	test("the written file is plain JSON with only the org and repo", () => {
		const path = writeProjectLink(root, { org: "acme", repo: "scratch" });
		expect(readFileSync(path, "utf8")).toBe(
			'{\n\t"org": "acme",\n\t"repo": "scratch"\n}\n',
		);
	});

	test("removing a link deletes the file", () => {
		const path = writeProjectLink(root, { repo: "scratch" });
		removeProjectLink(path);
		expect(findProjectLink(root, root)).toBeNull();
	});
});

describe("what a command acts on", () => {
	const found = {
		path: "/p/.tripwire/project.json",
		link: { org: "linked-org", repo: "linked-repo" },
	};

	test("an explicit repo wins over the link", () => {
		expect(resolveRepo("given", found)).toBe("given");
	});

	test("the link fills a repo that was left out", () => {
		expect(resolveRepo(undefined, found)).toBe("linked-repo");
	});

	test("no repo and no link names both ways out", () => {
		expect(() => resolveRepo(undefined, null)).toThrow(
			"No repo given. Pass one, or run tripwire link <repo> in this project.",
		);
	});

	test("--org wins, then TRIPWIRE_ORG, then the link", () => {
		expect(resolveOrg("flag", "env", found)).toBe("flag");
		expect(resolveOrg(undefined, "env", found)).toBe("env");
		expect(resolveOrg(undefined, undefined, found)).toBe("linked-org");
		expect(resolveOrg(undefined, "", found)).toBe("linked-org");
	});

	test("with no org anywhere the server picks your only org", () => {
		expect(resolveOrg(undefined, undefined, null)).toBeUndefined();
		expect(
			resolveOrg(undefined, undefined, {
				path: found.path,
				link: { repo: "x" },
			}),
		).toBeUndefined();
	});
});

describe("which tripwire.ts a command reads", () => {
	test("from a nested folder the default file is the linked project's", () => {
		const path = writeProjectLink(root, { repo: "scratch" });
		const nested = join(root, "src");
		mkdirSync(nested);
		expect(
			linkedWorkflowFile("tripwire.ts", true, nested, {
				path,
				link: { repo: "scratch" },
			}),
		).toBe(join(root, "tripwire.ts"));
	});

	test("a tripwire.ts in the current folder wins over the link's", () => {
		const path = writeProjectLink(root, { repo: "scratch" });
		const nested = join(root, "src");
		mkdirSync(nested);
		writeFileSync(join(nested, "tripwire.ts"), "");
		expect(
			linkedWorkflowFile("tripwire.ts", true, nested, {
				path,
				link: { repo: "scratch" },
			}),
		).toBe("tripwire.ts");
	});

	test("an explicit --file and no link both keep the file as given", () => {
		const path = writeProjectLink(root, { repo: "scratch" });
		const found = { path, link: { repo: "scratch" } };
		expect(linkedWorkflowFile("other.ts", false, root, found)).toBe("other.ts");
		expect(linkedWorkflowFile("tripwire.ts", true, root, null)).toBe(
			"tripwire.ts",
		);
	});
});
