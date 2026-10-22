import {
	type InstallAccessResult,
	type WorkflowDefinition,
	workflowDefinitionSchema,
} from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import { inArray } from "drizzle-orm";
import type { Db } from "./client.ts";
import { events } from "./schema/events.ts";
import { workflowDefinitions } from "./schema/repos.ts";
import { ensureDemoRepo } from "./seed.ts";
import { ensureDemoGithubAccount, seedWorkflowCatalog } from "./seed-extras.ts";
import { recordInstallAccessCheck } from "./services/installation-access.ts";
import * as workflowServices from "./services/workflows.ts";

export type DemoWorkflowMode = "none" | "off" | "live" | "issues";

export const LIVE_WORKFLOW_NAME = "block crypto spam";
export const BROKEN_WORKFLOW_NAME = "legacy review gate";

const CHANGE_REQUEST_KINDS = [
	"change-request.opened",
	"change-request.updated",
];

export function liveWorkflowDefinition(): WorkflowDefinition {
	return workflowDefinitionSchema.parse({
		id: generateId(),
		name: LIVE_WORKFLOW_NAME,
		version: 1,
		nodes: [
			{
				id: "t",
				type: "trigger",
				kinds: CHANGE_REQUEST_KINDS,
				position: { x: 0, y: 160 },
			},
			{
				id: "r",
				type: "rule",
				ref: "crypto-address@1",
				config: {},
				position: { x: 400, y: 160 },
			},
			{
				id: "block",
				type: "action",
				action: "block",
				position: { x: 800, y: 160 },
			},
		],
		edges: [
			{ id: "e1", from: "t", to: "r" },
			{ id: "e2", from: "r", to: "block", when: "fail" },
		],
	});
}

export function brokenWorkflowDefinition(): WorkflowDefinition {
	return workflowDefinitionSchema.parse({
		id: generateId(),
		name: BROKEN_WORKFLOW_NAME,
		version: 1,
		nodes: [
			{
				id: "t",
				type: "trigger",
				kinds: CHANGE_REQUEST_KINDS,
				position: { x: 0, y: 260 },
			},
			{
				id: "age",
				type: "rule",
				ref: "account-age@1",
				config: { minDays: 7 },
				position: { x: 400, y: 60 },
			},
			{
				id: "gate",
				type: "gate",
				mode: "all-of",
				position: { x: 800, y: 260 },
			},
			{
				id: "review",
				type: "action",
				action: "request-review",
				params: { reviewers: [], teamReviewers: [] },
				position: { x: 1200, y: 260 },
			},
		],
		edges: [
			{ id: "e1", from: "t", to: "age" },
			{ id: "e2", from: "t", to: "gate" },
			{ id: "e3", from: "age", to: "gate", when: "fail" },
			{ id: "e4", from: "gate", to: "review", when: "fail" },
		],
	});
}

export async function seedDemoWorkflows(
	db: Db,
	input: { repoIds: string[]; mode: DemoWorkflowMode },
): Promise<string | null> {
	if (input.repoIds.length > 0) {
		await db
			.delete(workflowDefinitions)
			.where(inArray(workflowDefinitions.repoId, input.repoIds));
	}
	const repoId = input.repoIds[0];
	if (input.mode === "none" || repoId === undefined) {
		return null;
	}
	await seedWorkflowCatalog(db, repoId);
	if (input.mode === "off") {
		const [first] = await workflowServices.listWorkflows(db, repoId);
		return first?.id ?? null;
	}
	const live = await workflowServices.createWorkflow(db, {
		repoId,
		name: LIVE_WORKFLOW_NAME,
		definition: liveWorkflowDefinition(),
	});
	const enabled = await workflowServices.setWorkflowEnabled(db, {
		repoId,
		workflowId: live.id,
		enabled: true,
	});
	if (!enabled.ok) {
		throw new Error(
			`live demo workflow failed validation: ${enabled.issues.map((issue) => issue.message).join("; ")}`,
		);
	}
	if (input.mode === "live") {
		return live.id;
	}
	const id = generateId();
	const now = new Date();
	await db.insert(workflowDefinitions).values({
		id,
		repoId,
		name: BROKEN_WORKFLOW_NAME,
		enabled: true,
		definition: brokenWorkflowDefinition(),
		createdAt: now,
		updatedAt: now,
	});
	return id;
}

export async function seedUnclaimedInstall(
	db: Db,
	input: {
		installationId: string;
		account: string;
		repoNames: string[];
		installerUserId: string | null;
		now: Date;
	},
): Promise<void> {
	const senderId = input.installerUserId
		? await ensureDemoGithubAccount(db, input.installerUserId)
		: null;
	for (const name of input.repoNames) {
		await ensureDemoRepo(db, name, { installationId: input.installationId });
	}
	await db
		.insert(events)
		.values({
			id: `demo-evt-install-${input.installationId}`,
			forge: "github",
			deliveryId: `demo-delivery-install-${input.installationId}`,
			rawKind: "installation",
			raw: {
				action: "created",
				installation: {
					id: input.installationId,
					account: { login: input.account },
				},
				sender: senderId ? { id: senderId } : null,
			},
			receivedAt: new Date(input.now.getTime() - 60 * 1000),
			kind: "installation.created",
		})
		.onConflictDoNothing();
}

export type DemoRecoveryState =
	| "processing"
	| "recovering"
	| "unreadable"
	| "missing"
	| "not-for-tripwire"
	| "not-yours"
	| "token-expired";

const RECOVERY_CHECKS = {
	processing: null,
	recovering: "pending",
	unreadable: null,
	missing: "failed",
	"not-for-tripwire": "not-for-tripwire",
	"not-yours": "denied",
	"token-expired": "token-expired",
} satisfies Record<DemoRecoveryState, InstallAccessResult | null>;

function recoveryEvent(input: {
	installationId: string;
	state: DemoRecoveryState;
	receivedAt: Date;
}) {
	const raw = {
		action: "created",
		installation: {
			id: input.installationId,
			account: { id: "demo-gh-stranger", login: "someone-else" },
		},
		sender: { id: "demo-gh-stranger" },
	};
	const base = {
		id: `demo-evt-install-${input.installationId}`,
		forge: "github" as const,
		deliveryId: `demo-delivery-install-${input.installationId}`,
		rawKind: "installation",
		raw,
		receivedAt: input.receivedAt,
	};
	if (input.state === "processing") {
		return base;
	}
	if (input.state === "unreadable") {
		return {
			...base,
			quarantined: true,
			quarantineReason: "demo: payload failed to parse",
		};
	}
	if (input.state === "not-yours") {
		return { ...base, kind: "installation.created" };
	}
	return null;
}

export async function seedInstallRecoveryState(
	db: Db,
	input: {
		installationId: string;
		state: DemoRecoveryState;
		userId: string;
		now: Date;
	},
): Promise<void> {
	await ensureDemoGithubAccount(db, input.userId);
	const event = recoveryEvent({
		installationId: input.installationId,
		state: input.state,
		receivedAt: new Date(input.now.getTime() - 60 * 1000),
	});
	if (event) {
		await db.insert(events).values(event).onConflictDoNothing();
	}
	const result = RECOVERY_CHECKS[input.state];
	if (result) {
		await recordInstallAccessCheck(db, {
			userId: input.userId,
			forge: "github",
			installationId: input.installationId,
			result,
			at: input.now,
		});
	}
}
