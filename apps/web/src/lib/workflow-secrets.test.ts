import { describe, expect, test } from "bun:test";
import type { WorkflowDefinition } from "@tripwire/contracts";
import {
	redactWorkflowSecrets,
	restoreWorkflowSecrets,
} from "./workflow-secrets";

function def(params: Record<string, unknown>): WorkflowDefinition {
	return {
		id: "wf1",
		name: "wf",
		version: 1,
		nodes: [
			{ id: "t", type: "trigger", kinds: ["change-request.opened"] },
			{ id: "w", type: "action", action: "webhook", params },
		],
		edges: [],
	} as WorkflowDefinition;
}

const webhookNode = (d: WorkflowDefinition) =>
	d.nodes.find((n) => n.id === "w") as Extract<
		WorkflowDefinition["nodes"][number],
		{ type: "action" }
	>;

describe("workflow secrets — set-only masking", () => {
	test("redact blanks stored secrets and marks them set", () => {
		const out = redactWorkflowSecrets(
			def({ url: "https://hook.example/x", signingSecret: "shh" }),
		);
		const params = webhookNode(out).params ?? {};
		expect(params.url).toBe("");
		expect(params.urlSet).toBe(true);
		expect(params.signingSecret).toBe("");
		expect(params.signingSecretSet).toBe(true);
	});

	test("the full secret never appears in the redacted output", () => {
		const out = redactWorkflowSecrets(
			def({
				url: "https://hook.example/secret-path",
				signingSecret: "topsecret",
			}),
		);
		expect(JSON.stringify(out)).not.toContain("secret-path");
		expect(JSON.stringify(out)).not.toContain("topsecret");
	});

	test("a blank field on save keeps the stored value (set-only)", () => {
		const stored = def({ url: "https://hook.example/x", signingSecret: "shh" });
		const incoming = def({ url: "", signingSecret: "", urlSet: true });
		const { definition, error } = restoreWorkflowSecrets(incoming, stored);
		const params = webhookNode(definition).params ?? {};
		expect(error).toBeUndefined();
		expect(params.url).toBe("https://hook.example/x");
		expect(params.signingSecret).toBe("shh");
		// markers stripped before persist
		expect(params.urlSet).toBeUndefined();
	});

	test("a new value overwrites the stored one", () => {
		const stored = def({ url: "https://old.example/x" });
		const incoming = def({ url: "https://new.example/y" });
		const { definition } = restoreWorkflowSecrets(incoming, stored);
		expect(webhookNode(definition).params?.url).toBe("https://new.example/y");
	});

	test("a non-https url is rejected at save", () => {
		const incoming = def({ url: "http://insecure.example/x" });
		const { error } = restoreWorkflowSecrets(incoming, null);
		expect(error).toContain("https");
	});

	test("a private-address url is rejected at save", () => {
		const incoming = def({ url: "https://127.0.0.1/x" });
		const { error } = restoreWorkflowSecrets(incoming, null);
		expect(error).toBeDefined();
	});
});
