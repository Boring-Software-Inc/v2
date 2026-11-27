import { z } from "zod";
import { createAppJwt, type GithubAppCredentials } from "./auth.ts";

const PAGE_SIZE = 100;
const MAX_PAGES = 50;

const deliverySchema = z.object({
	id: z.number(),
	guid: z.string(),
	delivered_at: z.string(),
	redelivery: z.boolean(),
	status_code: z.number(),
	event: z.string(),
	action: z.string().nullable().optional(),
	installation_id: z.number().nullable().optional(),
	repository_id: z.number().nullable().optional(),
});

const deliveryDetailSchema = z.object({
	event: z.string(),
	request: z.object({ payload: z.unknown() }),
});

/** One attempt at a webhook delivery; a redelivery keeps the original guid. */
export interface GithubDelivery {
	id: number;
	/** X-GitHub-Delivery, which ingest stores as the event's delivery id. */
	guid: string;
	deliveredAt: Date;
	redelivery: boolean;
	/** The receiver's HTTP status; 0 when it never answered. */
	statusCode: number;
	event: string;
	action: string | null;
	installationId: string | null;
	repositoryId: string | null;
}

export interface GithubAppDeliveriesOptions {
	credentials: GithubAppCredentials;
	apiBase?: string;
	fetchImpl?: typeof fetch;
}

/**
 * The App's own webhook delivery log, which GitHub keeps for three days. It is
 * the record of what GitHub sent, so it shows deliveries ingest failed or
 * never stored. GitHub never redelivers on its own; `redeliver` asks it to.
 */
export class GithubAppDeliveries {
	private readonly apiBase: string;
	private readonly fetchImpl: typeof fetch;

	constructor(private readonly options: GithubAppDeliveriesOptions) {
		this.apiBase = options.apiBase ?? "https://api.github.com";
		this.fetchImpl = options.fetchImpl ?? fetch;
	}

	private request(path: string, method = "GET") {
		return this.fetchImpl(`${this.apiBase}${path}`, {
			method,
			headers: {
				authorization: `Bearer ${createAppJwt(this.options.credentials)}`,
				accept: "application/vnd.github+json",
				"x-github-api-version": "2022-11-28",
			},
		});
	}

	/** Every attempt delivered at or after `since`, newest first. */
	async listSince(since: Date): Promise<GithubDelivery[]> {
		const found: GithubDelivery[] = [];
		let path: string | null = `/app/hook/deliveries?per_page=${PAGE_SIZE}`;
		for (let page = 0; path && page < MAX_PAGES; page++) {
			const res = await this.request(path);
			if (!res.ok)
				throw new Error(`GET /app/hook/deliveries failed: ${res.status}`);
			const rows = z.array(deliverySchema).parse(await res.json());
			let reachedSince = rows.length === 0;
			for (const row of rows) {
				const deliveredAt = new Date(row.delivered_at);
				if (deliveredAt < since) {
					reachedSince = true;
					continue;
				}
				found.push({
					id: row.id,
					guid: row.guid,
					deliveredAt,
					redelivery: row.redelivery,
					statusCode: row.status_code,
					event: row.event,
					action: row.action ?? null,
					installationId:
						row.installation_id == null ? null : String(row.installation_id),
					repositoryId:
						row.repository_id == null ? null : String(row.repository_id),
				});
			}
			path = reachedSince ? null : nextPath(res.headers.get("link"));
		}
		return found;
	}

	/** The payload GitHub sent, as the raw body ingest would have received. */
	async payload(deliveryId: number): Promise<{ event: string; body: string }> {
		const res = await this.request(`/app/hook/deliveries/${deliveryId}`);
		if (!res.ok)
			throw new Error(
				`GET /app/hook/deliveries/${deliveryId} failed: ${res.status}`,
			);
		const detail = deliveryDetailSchema.parse(await res.json());
		return {
			event: detail.event,
			body: JSON.stringify(detail.request.payload),
		};
	}

	/** Asks GitHub to send the delivery again; it arrives with the same guid. */
	async redeliver(deliveryId: number): Promise<void> {
		const res = await this.request(
			`/app/hook/deliveries/${deliveryId}/attempts`,
			"POST",
		);
		if (!res.ok)
			throw new Error(
				`POST /app/hook/deliveries/${deliveryId}/attempts failed: ${res.status}`,
			);
	}
}

/** The `rel="next"` page of a Link header, as a path on the API. */
function nextPath(link: string | null): string | null {
	const next = link
		?.split(",")
		.map((part) => part.match(/<([^>]+)>;\s*rel="next"/)?.[1])
		.find(Boolean);
	if (!next) return null;
	const url = new URL(next);
	return `${url.pathname}${url.search}`;
}
