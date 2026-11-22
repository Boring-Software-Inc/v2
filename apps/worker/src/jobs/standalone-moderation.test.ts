import { expect, test } from "bun:test";
import { ruleIdOf } from "@tripwire/contracts";
import { deriveDefaultWorkflow } from "@tripwire/core";
import { standaloneChecks } from "./standalone-moderation.ts";

test("issue moderation keeps rules that inspect issue title and body", () => {
	const definition = deriveDefaultWorkflow(
		[
			{ ref: "crypto-address@3", enabled: true, config: {} },
			{ ref: "english-only@1", enabled: true, config: {} },
			{ ref: "max-files-changed@1", enabled: true, config: {} },
		],
		new Set(),
		"gitcafe",
	);
	const refs = standaloneChecks(definition, "issue").nodes.flatMap((node) =>
		node.type === "rule" ? [ruleIdOf(node.ref)] : [],
	);
	expect(refs).toContain("crypto-address");
	expect(refs).not.toContain("english-only");
	expect(refs).not.toContain("max-files-changed");
});
