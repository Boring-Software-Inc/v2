import { expect, test } from "bun:test";
import {
	type Deployment,
	replacedDeployments,
	TARGETS,
	unkeyDeployState,
} from "./post-deploy.ts";

test("waits for every Unkey deploy, and fails on any failed one", () => {
	const ci = { context: "migrate", state: "success" } as const;
	expect(unkeyDeployState([ci])).toBe("none");
	expect(
		unkeyDeployState([
			ci,
			{ context: "Unkey / tripwire/api - production", state: "success" },
			{ context: "Unkey / tripwire/web - production", state: "pending" },
		]),
	).toBe("pending");
	expect(
		unkeyDeployState([
			{ context: "Unkey / tripwire/api - production", state: "success" },
			{ context: "Unkey / tripwire/web - production", state: "failure" },
		]),
	).toBe("failed");
	expect(
		unkeyDeployState([
			{ context: "Unkey / tripwire/api - production", state: "success" },
		]),
	).toBe("done");
});

const deployment = (
	id: string,
	fields: Partial<Deployment> & { sha?: string; branch?: string },
): Deployment => ({
	id,
	status: "ready",
	isCurrent: false,
	environment: "production",
	createdAt: 0,
	git: { branch: fields.branch ?? "main", commitSha: fields.sha ?? "old" },
	...fields,
});

test("in production, stops every running deployment Unkey isn't serving", () => {
	const [production] = TARGETS.main.replaced;
	if (!production) throw new Error("main replaces production deployments");
	const stopped = replacedDeployments(
		[
			deployment("serving", { isCurrent: true, sha: "new" }),
			deployment("yesterday", {}),
			deployment("first-try", { sha: "new" }),
			deployment("already-stopped", { status: "stopped" }),
			deployment("a-preview", { environment: "preview" }),
		],
		production,
		"new",
	);
	expect(stopped.map((d) => d.id)).toEqual(["yesterday", "first-try"]);
});

test("in a preview environment, stops only this branch's older deploys", () => {
	const preview = TARGETS.staging.replaced.find((r) => r.branch);
	if (!preview) throw new Error("staging replaces its preview deploys");
	const previews = [
		deployment("older", {
			environment: "preview",
			branch: "staging",
			createdAt: 1,
		}),
		deployment("ours", {
			environment: "preview",
			branch: "staging",
			sha: "new",
			createdAt: 2,
		}),
		deployment("newer-push", {
			environment: "preview",
			branch: "staging",
			sha: "next",
			createdAt: 3,
		}),
		deployment("a-pr", {
			environment: "preview",
			branch: "claude/fix",
			createdAt: 1,
		}),
	];
	expect(
		replacedDeployments(previews, preview, "new").map((d) => d.id),
	).toEqual(["older"]);
	// When this commit's deploy isn't there, nothing is known to replace anything.
	expect(replacedDeployments(previews, preview, "missing")).toEqual([]);
});
