import {
	COMMENT_MARKER,
	type GitCafeActionBinding,
	type GitCafeActionComment,
	type GitCafeActionOperation,
	type GitCafeActionReview,
	type GitCafeInstallation,
	type GitCafeReadBoundary,
	gitCafeActionBindingSchema,
	gitCafeActionCommentPageSchema,
	gitCafeActionCommentSchema,
	gitCafeActionCommentWriteSchema,
	gitCafeActionCreatedReviewSchema,
	gitCafeActionDismissInputSchema,
	gitCafeActionLabelInputSchema,
	gitCafeActionLabelPageSchema,
	gitCafeActionLabelResultSchema,
	gitCafeActionLockInputSchema,
	gitCafeActionOperationSchema,
	gitCafeActionReviewerInputSchema,
	gitCafeActionReviewerPageSchema,
	gitCafeActionReviewerResultSchema,
	gitCafeActionReviewPageSchema,
	gitCafeActionReviewSchema,
	gitCafeActionSubjectSchema,
	gitCafeActionVersionInputSchema,
} from "@tripwire/contracts";
import type { ForgeAction } from "@tripwire/forge";
import { reportGitCafeCheck } from "./checks.ts";
import type {
	GitCafeInstallationClient,
	GitCafeInstallationFailure,
} from "./installation-client.ts";

export type GitCafeActionResult<T> =
	| { ok: true; value: T }
	| GitCafeInstallationFailure
	| {
			ok: false;
			reason:
				| "permission"
				| "uncertain"
				| "incomplete"
				| "conflict"
				| "target-unavailable";
	  };

export interface GitCafeActionStore {
	read(actionId: string): Promise<GitCafeActionOperation | null>;
	prepare(
		operation: GitCafeActionOperation,
	): Promise<GitCafeActionOperation | null>;
	/** Exactly one dispatcher may attempt a comment create; all later attempts reconcile its marker. */
	claimComment(actionId: string): Promise<boolean>;
	releaseComment(actionId: string): Promise<void>;
}

export interface GitCafeActionsOptions {
	client: GitCafeInstallationClient;
	installation: GitCafeInstallation;
	store: GitCafeActionStore;
	deadlineAt?: number;
}

/** Installed writes share the read transport's authority fences and persist create inputs before dispatch. */
export class GitCafeActions {
	private readonly deadlineAt: number;
	constructor(private readonly options: GitCafeActionsOptions) {
		this.deadlineAt = options.deadlineAt ?? Date.now() + 300_000;
	}

	async execute(
		action: ForgeAction,
		input: GitCafeActionBinding,
	): Promise<GitCafeActionResult<{ externalId: string | null }>> {
		const parsed = gitCafeActionBindingSchema.safeParse(input);
		if (!parsed.success) return { ok: false, reason: "invalid-response" };
		const binding = parsed.data;
		if (
			action.repoFullName !== binding.repoFullName ||
			binding.installationId !== this.options.installation.id ||
			("number" in action && action.number !== binding.number)
		)
			return { ok: false, reason: "identity-mismatch" };
		const subject = await this.subject(binding);
		if (!subject.ok) return subject;
		switch (action.kind) {
			case "set-check": {
				if (
					binding.subject !== "change-request" ||
					binding.headOid !== action.check.sha
				)
					return { ok: false, reason: "identity-mismatch" };
				const check = await reportGitCafeCheck(
					this.options.client,
					binding.installationId,
					this.options.installation,
					{
						repoFullName: binding.repoFullName,
						headOid: action.check.sha,
						key: "tripwire",
						check: {
							name: "tripwire",
							status: "completed",
							conclusion:
								action.check.conclusion === "pending"
									? "action_required"
									: action.check.conclusion,
							reportedAt: binding.recordedAt,
							externalId: binding.actionId,
							detailsUrl: action.check.detailsUrl,
							output: { title: "Tripwire", summary: action.check.summary },
							rerequestable: true,
						},
					},
					this.deadlineAt,
				);
				return check.ok
					? { ok: true, value: { externalId: check.value.checkRun.id } }
					: check;
			}
			case "block":
			case "update-review":
				return this.review(binding, action.reason);
			case "dismiss-review":
				return this.dismissAll(binding, action.reviewId);
			case "comment":
				return this.comment(binding, action);
			case "post-comment":
				return this.comment(binding, action);
			case "delete-comment":
				return this.deleteComment(binding);
			case "label":
			case "remove-label":
				return this.labels(
					binding,
					action.labels,
					action.kind === "remove-label",
				);
			case "request-review":
				return this.reviewers(binding, action.reviewers, action.teamReviewers);
			case "close":
				return this.close(binding);
			case "lock":
				return this.lock(binding, action.reason);
			default:
				action satisfies never;
				return { ok: false, reason: "configuration" };
		}
	}

	private root(binding: GitCafeActionBinding): string {
		return `repos/${binding.repoFullName}/${binding.subject === "issue" ? "issues" : "pulls"}/${binding.number}`;
	}

	private async get<T>(
		path: string,
		schema: GitCafeReadBoundary<T>,
	): Promise<GitCafeActionResult<T>> {
		const result = await this.options.client.request(
			this.options.installation.id,
			{ method: "GET", resourcePath: path },
			this.options.installation,
			this.deadlineAt,
		);
		if (!result.ok) return result;
		const parsed = schema.safeParse(result.value);
		return parsed.success
			? { ok: true, value: parsed.data }
			: { ok: false, reason: "invalid-response" };
	}

	private async list<T>(
		path: string,
		schema: GitCafeReadBoundary<{ items: T[]; next: string | null }>,
	): Promise<GitCafeActionResult<T[]>> {
		const items: T[] = [];
		const seen = new Set<string>();
		let after: string | null = null;
		do {
			const query = new URLSearchParams({ limit: "100" });
			if (after !== null) query.set("after", after);
			const page = await this.get(`${path}?${query}`, schema);
			if (!page.ok) return page;
			items.push(...page.value.items);
			after = page.value.next;
			if (after !== null && seen.has(after))
				return { ok: false, reason: "incomplete" };
			if (after !== null) seen.add(after);
		} while (after !== null);
		return { ok: true, value: items };
	}

	private async subject(binding: GitCafeActionBinding) {
		const result = await this.get(
			this.root(binding),
			gitCafeActionSubjectSchema,
		);
		if (!result.ok) return result;
		if (result.value.repoId !== binding.repositoryId)
			return { ok: false as const, reason: "identity-mismatch" as const };
		if (
			binding.subject === "change-request" &&
			binding.headOid !== null &&
			result.value.headOid !== binding.headOid
		)
			return { ok: false as const, reason: "stale" as const };
		return result;
	}

	private ownsReview(review: GitCafeActionReview): boolean {
		return (
			review.authorActorId === this.options.installation.bot.actorId &&
			review.authorViaInstallationId === this.options.installation.id
		);
	}

	private async review(binding: GitCafeActionBinding, body: string) {
		if (binding.subject !== "change-request" || binding.headOid === null)
			return { ok: false as const, reason: "invalid-response" as const };
		const reviews = await this.list(
			`${this.root(binding)}/reviews`,
			gitCafeActionReviewPageSchema,
		);
		if (!reviews.ok) return reviews;
		const active = reviews.value.filter(
			(review) =>
				this.ownsReview(review) &&
				review.dismissedAt === null &&
				review.verdict === "request_changes",
		);
		let current = active.find(
			(review) => review.commitOid === binding.headOid && review.body === body,
		);
		if (!current) {
			const pull = await this.subject(binding);
			if (!pull.ok) return pull;
			const prepared = await this.options.store.prepare(
				gitCafeActionOperationSchema.parse({
					...binding,
					format: "gitcafe-action@1",
					dispatched: false,
					command: {
						kind: "review",
						input: {
							verdict: "request_changes",
							body,
							commitOid: binding.headOid,
							expectedVersion: pull.value.version,
							requestId: binding.actionId,
						},
					},
				}),
			);
			if (!prepared) return { ok: false as const, reason: "inactive" as const };
			if (
				prepared.command.kind !== "review" ||
				prepared.command.input.body !== body ||
				prepared.command.input.commitOid !== binding.headOid
			)
				return { ok: false as const, reason: "identity-mismatch" as const };
			const created = await this.options.client.request(
				binding.installationId,
				{
					method: "POST",
					resourcePath: `${this.root(binding)}/reviews`,
					body: JSON.stringify(prepared.command.input),
				},
				this.options.installation,
				this.deadlineAt,
			);
			if (!created.ok) return created;
			const receipt = gitCafeActionCreatedReviewSchema.safeParse(created.value);
			if (!receipt.success)
				return { ok: false as const, reason: "invalid-response" as const };
			if (
				receipt.data.author.actorId !== this.options.installation.bot.actorId ||
				receipt.data.commitOid !== binding.headOid ||
				receipt.data.verdict !== "request_changes"
			)
				return { ok: false as const, reason: "identity-mismatch" as const };
			const readback = await this.get(
				`${this.root(binding)}/reviews/${receipt.data.id}`,
				gitCafeActionReviewSchema,
			);
			if (!readback.ok) return readback;
			if (
				!this.ownsReview(readback.value) ||
				readback.value.body !== body ||
				readback.value.commitOid !== binding.headOid ||
				readback.value.verdict !== "request_changes" ||
				readback.value.dismissedAt !== null
			)
				return { ok: false as const, reason: "identity-mismatch" as const };
			current = readback.value;
		}
		for (const previous of active) {
			if (previous.id === current.id) continue;
			const dismissed = await this.dismiss(binding, previous.id);
			if (!dismissed.ok) return dismissed;
		}
		return { ok: true as const, value: { externalId: current.id } };
	}

	private async dismissAll(
		binding: GitCafeActionBinding,
		reviewId: string | null,
	) {
		if (reviewId !== null) {
			const target = await this.get(
				`${this.root(binding)}/reviews/${encodeURIComponent(reviewId)}`,
				gitCafeActionReviewSchema,
			);
			if (!target.ok) return target;
			if (!this.ownsReview(target.value))
				return { ok: false as const, reason: "identity-mismatch" as const };
		}
		const reviews = await this.list(
			`${this.root(binding)}/reviews`,
			gitCafeActionReviewPageSchema,
		);
		if (!reviews.ok) return reviews;
		for (const review of reviews.value) {
			if (
				!this.ownsReview(review) ||
				review.verdict !== "request_changes" ||
				review.dismissedAt !== null
			)
				continue;
			const result = await this.dismiss(binding, review.id);
			if (!result.ok) return result;
		}
		return { ok: true as const, value: { externalId: reviewId } };
	}

	private async dismiss(binding: GitCafeActionBinding, reviewId: string) {
		const review = await this.get(
			`${this.root(binding)}/reviews/${encodeURIComponent(reviewId)}`,
			gitCafeActionReviewSchema,
		);
		if (!review.ok) return review;
		if (!this.ownsReview(review.value))
			return { ok: false as const, reason: "identity-mismatch" as const };
		if (review.value.dismissedAt !== null)
			return { ok: true as const, value: { externalId: reviewId } };
		const pull = await this.subject(binding);
		if (!pull.ok) return pull;
		const result = await this.options.client.request(
			binding.installationId,
			{
				method: "POST",
				resourcePath: `${this.root(binding)}/reviews/${encodeURIComponent(reviewId)}/dismiss`,
				body: JSON.stringify(
					gitCafeActionDismissInputSchema.parse({
						expectedVersion: review.value.version,
						expectedPullVersion: pull.value.version,
						reason: "Tripwire no longer requires this blocking review.",
					}),
				),
			},
			this.options.installation,
			this.deadlineAt,
		);
		if (!result.ok) return result;
		const readback = await this.get(
			`${this.root(binding)}/reviews/${encodeURIComponent(reviewId)}`,
			gitCafeActionReviewSchema,
		);
		return readback.ok &&
			this.ownsReview(readback.value) &&
			readback.value.dismissedAt !== null
			? { ok: true as const, value: { externalId: reviewId } }
			: readback.ok
				? { ok: false as const, reason: "conflict" as const }
				: readback;
	}

	private async comment(
		binding: GitCafeActionBinding,
		action: Extract<ForgeAction, { kind: "comment" | "post-comment" }>,
	) {
		const comments = await this.list(
			`${this.root(binding)}/comments/`,
			gitCafeActionCommentPageSchema,
		);
		if (!comments.ok) return comments;
		const marker = `<!-- tripwire-action:${binding.actionId} -->`;
		const body = `${action.body}\n\n${action.kind === "post-comment" ? action.marker : ""}\n${marker}`;
		const owned = comments.value.filter(
			(comment) =>
				comment.authorActorId === this.options.installation.bot.actorId &&
				comment.deletedAt == null,
		);
		const delivered = owned.find((comment) => comment.body === body);
		if (delivered)
			return { ok: true as const, value: { externalId: delivered.id } };
		if (action.kind === "post-comment") {
			const existing = owned.find((comment) =>
				comment.body?.includes(action.marker),
			);
			if (existing)
				return { ok: true as const, value: { externalId: existing.id } };
		}
		const active =
			action.kind === "comment"
				? [...owned]
						.reverse()
						.find((comment) => comment.body?.includes(COMMENT_MARKER))
				: undefined;
		const prior = await this.options.store.read(binding.actionId);
		if (action.kind === "comment" && action.onlyIfPresent && !active && !prior)
			return { ok: true as const, value: { externalId: null } };
		if (
			active &&
			action.kind === "comment" &&
			(action.previousVerdict === null ||
				action.previousVerdict === action.verdict)
		)
			return this.editComment(binding, active, body);
		const operation = await this.options.store.prepare(
			gitCafeActionOperationSchema.parse({
				...binding,
				format: "gitcafe-action@1",
				dispatched: false,
				command: { kind: "comment", body },
			}),
		);
		if (!operation) return { ok: false as const, reason: "inactive" as const };
		if (operation.command.kind !== "comment" || operation.command.body !== body)
			return { ok: false as const, reason: "identity-mismatch" as const };
		if (active) {
			const old = await this.editComment(
				binding,
				active,
				`${(active.body ?? "").replaceAll(COMMENT_MARKER, "")}\n\nSuperseded by a newer Tripwire verdict.`,
			);
			if (!old.ok) return old;
		}
		const current = await this.subject(binding);
		if (!current.ok) return current;
		if (!(await this.options.store.claimComment(binding.actionId)))
			return { ok: false as const, reason: "uncertain" as const };
		const result = await this.options.client.request(
			binding.installationId,
			{
				method: "POST",
				resourcePath: `${this.root(binding)}/comments/`,
				body: JSON.stringify(gitCafeActionCommentWriteSchema.parse({ body })),
			},
			this.options.installation,
			this.deadlineAt,
		);
		if (!result.ok) {
			if (
				result.reason === "http" &&
				[400, 401, 403, 404, 409, 422, 429].includes(result.status ?? 0)
			)
				await this.options.store.releaseComment(binding.actionId);
			return result;
		}
		const created = gitCafeActionCommentSchema.safeParse(result.value);
		if (
			!created.success ||
			created.data.authorActorId !== this.options.installation.bot.actorId ||
			created.data.body !== body
		)
			return { ok: false as const, reason: "identity-mismatch" as const };
		return { ok: true as const, value: { externalId: created.data.id } };
	}

	private async editComment(
		binding: GitCafeActionBinding,
		comment: GitCafeActionComment,
		body: string,
	) {
		if (!comment.capabilities.edit)
			return { ok: false as const, reason: "permission" as const };
		const current = await this.subject(binding);
		if (!current.ok) return current;
		const result = await this.options.client.request(
			binding.installationId,
			{
				method: "PATCH",
				resourcePath: `${this.root(binding)}/comments/${encodeURIComponent(comment.id)}`,
				body: JSON.stringify(
					gitCafeActionCommentWriteSchema.parse({
						body,
						expectedVersion: comment.version,
					}),
				),
			},
			this.options.installation,
			this.deadlineAt,
		);
		if (!result.ok) return result;
		const edited = gitCafeActionCommentSchema.safeParse(result.value);
		return edited.success &&
			edited.data.id === comment.id &&
			edited.data.authorActorId === this.options.installation.bot.actorId &&
			edited.data.body === body
			? { ok: true as const, value: { externalId: edited.data.id } }
			: { ok: false as const, reason: "identity-mismatch" as const };
	}

	private async labels(
		binding: GitCafeActionBinding,
		names: string[],
		remove: boolean,
	) {
		const before = await this.subject(binding);
		if (!before.ok) return before;
		const current = await this.list(
			`${this.root(binding)}/labels`,
			gitCafeActionLabelPageSchema,
		);
		if (!current.ok) return current;
		const desired = new Map(current.value.map((label) => [label.id, label]));
		if (remove) {
			for (const label of current.value)
				if (names.includes(label.name)) desired.delete(label.id);
		} else {
			const catalog = await this.list(
				`repos/${binding.repoFullName}/labels`,
				gitCafeActionLabelPageSchema,
			);
			if (!catalog.ok) return catalog;
			for (const name of names) {
				const label = catalog.value.find((entry) => entry.name === name);
				if (!label)
					return { ok: false as const, reason: "target-unavailable" as const };
				desired.set(label.id, label);
			}
		}
		const after = await this.subject(binding);
		if (!after.ok) return after;
		if (after.value.version !== before.value.version)
			return { ok: false as const, reason: "conflict" as const };
		const input = gitCafeActionLabelInputSchema.safeParse({
			expectedVersion: after.value.version,
			labelIds: [...desired.keys()],
		});
		if (!input.success)
			return { ok: false as const, reason: "target-unavailable" as const };
		const response = await this.options.client.request(
			binding.installationId,
			{
				method: "PUT",
				resourcePath: `${this.root(binding)}/labels`,
				body: JSON.stringify(input.data),
			},
			this.options.installation,
			this.deadlineAt,
		);
		if (!response.ok) return response;
		const result = gitCafeActionLabelResultSchema.safeParse(response.value);
		if (!result.success)
			return { ok: false as const, reason: "invalid-response" as const };
		const readback = await this.list(
			`${this.root(binding)}/labels`,
			gitCafeActionLabelPageSchema,
		);
		if (!readback.ok) return readback;
		return readback.value.length === desired.size &&
			readback.value.every((label) => desired.has(label.id))
			? { ok: true as const, value: { externalId: null } }
			: { ok: false as const, reason: "conflict" as const };
	}

	private async reviewers(
		binding: GitCafeActionBinding,
		people: string[],
		teams: string[],
	) {
		if (binding.subject !== "change-request")
			return { ok: false as const, reason: "target-unavailable" as const };
		const before = await this.subject(binding);
		if (!before.ok) return before;
		const current = await this.list(
			`${this.root(binding)}/reviewers`,
			gitCafeActionReviewerPageSchema,
		);
		if (!current.ok) return current;
		const candidates = await this.list(
			`${this.root(binding)}/reviewer-candidates`,
			gitCafeActionReviewerPageSchema,
		);
		if (!candidates.ok) return candidates;
		const desired = new Set(current.value.map((person) => person.id));
		for (const name of [...people, ...teams]) {
			const person = candidates.value.find(
				(candidate) => candidate.id === name || candidate.handle === name,
			);
			if (!person)
				return { ok: false as const, reason: "target-unavailable" as const };
			desired.add(person.id);
		}
		const after = await this.subject(binding);
		if (!after.ok) return after;
		if (after.value.version !== before.value.version)
			return { ok: false as const, reason: "conflict" as const };
		const input = gitCafeActionReviewerInputSchema.safeParse({
			expectedVersion: after.value.version,
			actorIds: [...desired],
		});
		if (!input.success)
			return { ok: false as const, reason: "target-unavailable" as const };
		const response = await this.options.client.request(
			binding.installationId,
			{
				method: "PUT",
				resourcePath: `${this.root(binding)}/reviewers`,
				body: JSON.stringify(input.data),
			},
			this.options.installation,
			this.deadlineAt,
		);
		if (!response.ok) return response;
		const result = gitCafeActionReviewerResultSchema.safeParse(response.value);
		if (!result.success)
			return { ok: false as const, reason: "invalid-response" as const };
		const readback = await this.list(
			`${this.root(binding)}/reviewers`,
			gitCafeActionReviewerPageSchema,
		);
		if (!readback.ok) return readback;
		return readback.value.length === desired.size &&
			readback.value.every((person) => desired.has(person.id))
			? { ok: true as const, value: { externalId: null } }
			: { ok: false as const, reason: "conflict" as const };
	}

	private async close(binding: GitCafeActionBinding) {
		const before = await this.subject(binding);
		if (!before.ok) return before;
		const closed =
			binding.subject === "change-request"
				? before.value.state === "closed"
				: ["completed", "canceled"].includes(before.value.stateType ?? "");
		if (closed)
			return { ok: true as const, value: { externalId: before.value.id } };
		const response = await this.options.client.request(
			binding.installationId,
			{
				method: "POST",
				resourcePath: `${this.root(binding)}/close`,
				body: JSON.stringify(
					gitCafeActionVersionInputSchema.parse({
						expectedVersion: before.value.version,
					}),
				),
			},
			this.options.installation,
			this.deadlineAt,
		);
		if (!response.ok) return response;
		const after = await this.subject(binding);
		if (!after.ok) return after;
		return (
			binding.subject === "change-request"
				? after.value.state === "closed"
				: ["completed", "canceled"].includes(after.value.stateType ?? "")
		)
			? { ok: true as const, value: { externalId: after.value.id } }
			: { ok: false as const, reason: "conflict" as const };
	}

	private async lock(
		binding: GitCafeActionBinding,
		reason?: Extract<ForgeAction, { kind: "lock" }>["reason"],
	) {
		const before = await this.subject(binding);
		if (!before.ok) return before;
		if (before.value.lockedAt !== null)
			return { ok: true as const, value: { externalId: before.value.id } };
		const reasons = {
			"off-topic": "off_topic",
			"too heated": "too_heated",
			resolved: "resolved",
			spam: "spam",
		} as const;
		const input = gitCafeActionLockInputSchema.parse({
			expectedVersion: before.value.version,
			reason: reasons[reason ?? "off-topic"],
		});
		const response = await this.options.client.request(
			binding.installationId,
			{
				method: binding.subject === "issue" ? "PUT" : "POST",
				resourcePath: `${this.root(binding)}/lock`,
				body: JSON.stringify(input),
			},
			this.options.installation,
			this.deadlineAt,
		);
		if (!response.ok) return response;
		const after = await this.subject(binding);
		if (!after.ok) return after;
		return after.value.lockedAt !== null
			? { ok: true as const, value: { externalId: after.value.id } }
			: { ok: false as const, reason: "conflict" as const };
	}

	private async deleteComment(binding: GitCafeActionBinding) {
		const comments = await this.list(
			`${this.root(binding)}/comments/`,
			gitCafeActionCommentPageSchema,
		);
		if (!comments.ok) return comments;
		const active = [...comments.value]
			.reverse()
			.find(
				(comment) =>
					comment.authorActorId === this.options.installation.bot.actorId &&
					comment.deletedAt == null &&
					comment.body?.includes(COMMENT_MARKER),
			);
		if (!active) return { ok: true as const, value: { externalId: null } };
		if (!active.capabilities.delete)
			return { ok: false as const, reason: "permission" as const };
		const current = await this.subject(binding);
		if (!current.ok) return current;
		const deleted = await this.options.client.request(
			binding.installationId,
			{
				method: "DELETE",
				resourcePath: `${this.root(binding)}/comments/${encodeURIComponent(active.id)}`,
				body: JSON.stringify(
					gitCafeActionVersionInputSchema.parse({
						expectedVersion: active.version,
					}),
				),
			},
			this.options.installation,
			this.deadlineAt,
		);
		if (!deleted.ok) return deleted;
		const remaining = await this.list(
			`${this.root(binding)}/comments/`,
			gitCafeActionCommentPageSchema,
		);
		return remaining.ok &&
			!remaining.value.some(
				(comment) => comment.id === active.id && comment.deletedAt == null,
			)
			? { ok: true as const, value: { externalId: active.id } }
			: remaining.ok
				? { ok: false as const, reason: "conflict" as const }
				: remaining;
	}
}
