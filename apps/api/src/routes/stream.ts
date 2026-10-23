import { assertApproved } from "@tripwire/auth/access-gate";
import { reposWithPermission } from "@tripwire/auth/org-gate";
import { eventServices } from "@tripwire/db";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { ApiEnv } from "../env.ts";

const HEARTBEAT_MS = 15_000;

/**
 * GET /events/stream — SSE fed by Postgres LISTEN/NOTIFY (§5 fan-out). Each
 * connection holds a dedicated client (a pooled connection can't LISTEN);
 * notifications carry the event id, the row is fetched and the normalized
 * event is pushed. The web head merges these into the Query cache.
 *
 * Session-gated: dashboard data is for maintainers. The webhook route stays
 * public (HMAC is its auth); /healthz stays open. In dev open posture
 * (auth null) the stream stays usable.
 */
export const stream = new Hono<ApiEnv>().get(
	"/stream",
	async (c, next) => {
		const { auth, db } = c.get("deps");
		if (auth) {
			const session = await auth.api.getSession({
				headers: c.req.raw.headers,
			});
			if (!session) {
				return c.json({ error: "session required" }, 401);
			}
			// Closed-beta gate: block pending/rejected users from live product
			// data. Same server-side flag evaluation as the web route gate.
			const denial = await assertApproved(
				db,
				session.user.id,
				session.user.email,
			);
			if (denial) {
				return c.json({ error: denial.message }, 403);
			}
			// §org-model visibility: a member of org A must not receive org B's
			// notifications. Snapshot the membership-visible repo set here;
			// refreshed on each heartbeat below so new grants land mid-stream.
			c.set(
				"visibleRepos",
				new Set(
					await reposWithPermission(db, session.user.id, "activity:read"),
				),
			);
		} else {
			c.set("visibleRepos", null);
		}
		return await next();
	},
	(c) =>
		streamSSE(c, async (s) => {
			const { db, directPool, logger } = c.get("deps");
			const client = await directPool.connect();
			let open = true;
			let visibleRepos = c.get("visibleRepos");
			const canSee = (repoFullName: string | null | undefined) =>
				visibleRepos === null ||
				(repoFullName != null && visibleRepos.has(repoFullName));

			const onNotification = async (msg: {
				channel?: string;
				payload?: string;
			}) => {
				if (!(open && msg.payload)) {
					return;
				}
				// `runs` → a run reached a resolved state (or none ran); re-fetch the
				// joined activity row so the feed resolves "evaluating…" in place (§9).
				if (msg.channel === "runs") {
					const row = await eventServices.getActivityForEvent(db, msg.payload);
					const rowRepo = (
						row?.event as { repo?: { fullName?: string } } | undefined
					)?.repo?.fullName;
					if (row && canSee(rowRepo ?? null)) {
						await s.writeSSE({
							event: "run",
							id: `${msg.payload}:run`,
							data: JSON.stringify(row),
						});
					}
					return;
				}
				const event = await eventServices.getEventById(db, msg.payload);
				if (event?.normalized) {
					const normalized = event.normalized as {
						repo?: { fullName?: string };
					};
					if (!canSee(normalized.repo?.fullName ?? null)) {
						return;
					}
					await s.writeSSE({
						event: "event",
						id: event.id,
						data: JSON.stringify(event.normalized),
					});
				}
			};

			client.on("notification", (msg) => {
				onNotification(msg).catch((error) =>
					logger.warn({ error }, "sse notification push failed"),
				);
			});
			await client.query("LISTEN events");
			await client.query("LISTEN runs");

			s.onAbort(() => {
				open = false;
				client.query("UNLISTEN events").catch(() => undefined);
				client.query("UNLISTEN runs").catch(() => undefined);
				client.release();
			});

			const { auth } = c.get("deps");
			const refreshVisibility = async () => {
				if (visibleRepos === null || !auth) {
					return;
				}
				const session = await auth.api.getSession({
					headers: c.req.raw.headers,
				});
				if (session) {
					visibleRepos = new Set(
						await reposWithPermission(db, session.user.id, "activity:read"),
					);
				}
			};

			while (open) {
				await s.writeSSE({ event: "heartbeat", data: String(Date.now()) });
				await refreshVisibility().catch(() => undefined);
				await s.sleep(HEARTBEAT_MS);
			}
		}),
);
