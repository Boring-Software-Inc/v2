import { createServerFn } from "@tanstack/react-start";
import type { NormalizedEvent } from "@tripwire/contracts";

export interface EventsPageData {
	items: NormalizedEvent[];
	nextCursor: string | null;
}

export const getEvents = createServerFn({ method: "GET" })
	.inputValidator((input: { cursor?: string } = {}) => input)
	.handler(async ({ data }): Promise<EventsPageData> => {
		const { eventServices } = await import("@tripwire/db");
		const { getDb } = await import("#/lib/server/db");
		const { db } = getDb();
		const page = await eventServices.listEvents(db, {
			cursor: data.cursor,
			limit: 50,
		});
		return {
			items: page.items
				.map((row) => row.normalized as NormalizedEvent | null)
				.filter((event): event is NormalizedEvent => event !== null),
			nextCursor: page.nextCursor,
		};
	});
