import { describe, expect, test } from "bun:test";
import { fenceAction, resolveDeploymentId } from "./fence.ts";

describe("fenceAction", () => {
	test("a paused deployment that leads starts consuming", () => {
		expect(fenceAction(false, "me", "me")).toBe("consume");
	});

	test("a consuming deployment that leads holds", () => {
		expect(fenceAction(true, "me", "me")).toBe("hold");
	});

	test("a consuming deployment that lost leadership pauses", () => {
		expect(fenceAction(true, "newer", "me")).toBe("pause");
	});

	test("a paused deployment that does not lead stays paused", () => {
		expect(fenceAction(false, "newer", "me")).toBe("hold");
	});

	test("no live leader fails open to consuming", () => {
		expect(fenceAction(false, null, "me")).toBe("consume");
		expect(fenceAction(true, null, "me")).toBe("hold");
	});
});

describe("resolveDeploymentId", () => {
	test("uses the Unkey deployment id when injected", () => {
		expect(resolveDeploymentId({ UNKEY_DEPLOYMENT_ID: "d_123" })).toBe("d_123");
	});

	test("falls back to a random id per process", () => {
		const a = resolveDeploymentId({});
		const b = resolveDeploymentId({ UNKEY_DEPLOYMENT_ID: "" });
		expect(a.startsWith("local-")).toBe(true);
		expect(a).not.toBe(b);
	});
});
