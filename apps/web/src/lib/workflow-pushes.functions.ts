import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import {
	type WorkflowPushOutcome,
	type WorkflowPushStatus,
	workflowPushDecisionSchema,
} from "@tripwire/contracts";
import type { OrgWithRole } from "@tripwire/db";
import { z } from "zod";
import { accessGuardMiddleware } from "#/lib/server/gated-server-fn";
import {
	orgPermissionMiddleware,
	resolveOrgRepo,
} from "#/lib/server/org-guard";
import type { PushReviewWorkflow } from "#/lib/workflow-push-review";

export interface WorkflowPushReviewData {
	id: string;
	status: WorkflowPushStatus;
	repoFullName: string;
	authorName: string;
	createdAt: string;
	expiresAt: string;
	decidedAt: string | null;
	decidedByName: string | null;
	blocked: boolean;
	workflows: PushReviewWorkflow[];
	outcomes: WorkflowPushOutcome[];
}

const reviewInput = z.object({
	org: z.string().min(1),
	repo: z.string().min(1),
	pushId: z.string().min(1),
});

export const getWorkflowPushReview = createServerFn({ method: "GET" })
	.middleware([
		accessGuardMiddleware,
		orgPermissionMiddleware("workflows:manage"),
	])
	.inputValidator((input: z.input<typeof reviewInput>) =>
		reviewInput.parse(input),
	)
	.handler(async ({ data, context }): Promise<WorkflowPushReviewData> => {
		const { org } = context as { org: OrgWithRole };
		const repo = await resolveOrgRepo(org.id, data.repo);
		const { workflowPushServices } = await import("@tripwire/db");
		const { getDb } = await import("#/lib/server/db");
		const review = await workflowPushServices.reviewWorkflowPush(getDb().db, {
			orgId: org.id,
			repoId: repo.id,
			pushId: data.pushId,
		});
		if (!review) {
			throw notFound();
		}
		const { pushReviewWorkflow } = await import("#/lib/workflow-push-review");
		return {
			id: review.id,
			status: review.status,
			repoFullName: review.repoFullName,
			authorName: review.authorName,
			createdAt: review.createdAt.toISOString(),
			expiresAt: review.expiresAt.toISOString(),
			decidedAt: review.decidedAt?.toISOString() ?? null,
			decidedByName: review.decidedByName,
			blocked: review.blocked,
			workflows: review.workflows.map((entry) =>
				pushReviewWorkflow({
					...entry,
					issues: entry.issues.map((issue) => ({
						severity: issue.severity,
						step: issue.step,
						message: issue.message,
					})),
				}),
			),
			outcomes: review.outcomes,
		};
	});

const decideInput = reviewInput.extend({
	decision: workflowPushDecisionSchema,
});

export type DecideWorkflowPushResponse =
	| { ok: true }
	| { ok: false; error: string };

function listText(names: readonly string[]): string {
	return names.length <= 1
		? (names[0] ?? "")
		: `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

const CLOSED_TEXT = {
	accepted: "This push was already accepted.",
	rejected: "This push was already declined.",
	expired: "This push expired. Push again from the CLI.",
	stale: "The workflows changed after this push. Push again from the CLI.",
} as const satisfies Record<Exclude<WorkflowPushStatus, "pending">, string>;

export const decideWorkflowPush = createServerFn({ method: "POST" })
	.middleware([
		accessGuardMiddleware,
		orgPermissionMiddleware("workflows:manage"),
	])
	.inputValidator((input: z.input<typeof decideInput>) =>
		decideInput.parse(input),
	)
	.handler(async ({ data, context }): Promise<DecideWorkflowPushResponse> => {
		const { assertSameOrigin } = await import("#/lib/server/same-origin");
		await assertSameOrigin();
		const { org } = context as { org: OrgWithRole };
		const repo = await resolveOrgRepo(org.id, data.repo);
		const { getAuth } = await import("#/lib/server/auth");
		const auth = getAuth();
		const { getStartContext } = await import("@tanstack/start-storage-context");
		const session = auth
			? await auth.api.getSession({
					headers: getStartContext().request.headers,
				})
			: null;
		if (!session) {
			throw new Error("Your session ended. Sign in again to continue.");
		}
		const { workflowPushServices } = await import("@tripwire/db");
		const { getDb } = await import("#/lib/server/db");
		const db = getDb().db;
		const push = await workflowPushServices.getWorkflowPush(db, {
			orgId: org.id,
			pushId: data.pushId,
		});
		if (!push || push.repoId !== repo.id) {
			throw notFound();
		}
		const result = await workflowPushServices.decideWorkflowPush(db, {
			orgId: org.id,
			pushId: data.pushId,
			userId: session.user.id,
			decision: data.decision,
		});
		if (result.ok) {
			return { ok: true };
		}
		switch (result.reason) {
			case "not-found":
				throw notFound();
			case "already-decided":
				return { ok: false, error: CLOSED_TEXT[result.status] };
			case "expired":
				return { ok: false, error: CLOSED_TEXT.expired };
			case "stale":
				return {
					ok: false,
					error: `${listText(result.workflows)} changed after this push. Push again from the CLI.`,
				};
			case "blocked":
				return {
					ok: false,
					error: result.blocks
						.map((block) => `${block.name}: ${block.issues.join(" ")}`)
						.join(" "),
				};
		}
	});
