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
 */
export const stream = new Hono<ApiEnv>().get("/stream", (c) =>
	streamSSE(c, async (s) => {
		const { db, pool, logger } = c.get("deps");
		const client = await pool.connect();
		let open = true;

		const onNotification = async (msg: { payload?: string }) => {
			if (!(open && msg.payload)) {
				return;
			}
			const event = await eventServices.getEventById(db, msg.payload);
			if (event?.normalized) {
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

		s.onAbort(() => {
			open = false;
			client.query("UNLISTEN events").catch(() => undefined);
			client.release();
		});

		while (open) {
			await s.writeSSE({ event: "heartbeat", data: String(Date.now()) });
			await s.sleep(HEARTBEAT_MS);
		}
	}),
);
