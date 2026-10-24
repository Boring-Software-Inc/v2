import {
	type DatabuddyFlag,
	databuddyErrorBodySchema,
	databuddyFlagListSchema,
	databuddyFlagSchema,
	databuddyQueryResultSchema,
} from "@tripwire/contracts";

export const DATABUDDY_API_URL = "https://api.databuddy.cc";

export interface DatabuddyApiConfig {
	apiKey: string;
	websiteId: string;
	baseUrl?: string;
	fetch?: typeof fetch;
	timeoutMs?: number;
}

export type DatabuddyQueryRow = Record<string, unknown>;

export interface DatabuddyApi {
	listFlags(): Promise<DatabuddyFlag[]>;
	getFlagByKey(key: string): Promise<DatabuddyFlag | null>;
	updateFlagRules(id: string, rules: unknown[]): Promise<DatabuddyFlag>;
	query(input: {
		parameters: string[];
		filters?: { field: string; op: "eq"; value: string }[];
		preset?: string;
		limit?: number;
	}): Promise<Record<string, DatabuddyQueryRow[]>>;
}

export class DatabuddyApiError extends Error {
	readonly status: number;
	constructor(status: number, message: string) {
		super(message);
		this.name = "DatabuddyApiError";
		this.status = status;
	}
}

function messageOf(body: unknown, status: number): string {
	const parsed = databuddyErrorBodySchema.safeParse(body);
	if (parsed.success) {
		const value = parsed.data;
		const message = value.json?.message ?? value.message ?? value.error;
		if (message) {
			return message;
		}
	}
	return `Databuddy answered ${status}`;
}

export function createDatabuddyApi(config: DatabuddyApiConfig): DatabuddyApi {
	const base = (config.baseUrl ?? DATABUDDY_API_URL).replace(/\/$/, "");
	const doFetch = config.fetch ?? fetch;
	const timeoutMs = config.timeoutMs ?? 10_000;

	async function post(path: string, body: unknown): Promise<unknown> {
		const response = await doFetch(`${base}${path}`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-api-key": config.apiKey,
			},
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(timeoutMs),
		});
		const text = await response.text();
		let parsed: unknown = null;
		try {
			parsed = text ? JSON.parse(text) : null;
		} catch {
			parsed = null;
		}
		if (!response.ok) {
			throw new DatabuddyApiError(
				response.status,
				messageOf(parsed, response.status),
			);
		}
		return parsed;
	}

	return {
		async listFlags() {
			const body = await post("/flags/list", {
				websiteId: config.websiteId,
				limit: 200,
			});
			return databuddyFlagListSchema.parse(body);
		},
		async getFlagByKey(key) {
			try {
				const body = await post("/flags/getByKey", {
					key,
					websiteId: config.websiteId,
				});
				return databuddyFlagSchema.parse(body);
			} catch (error) {
				if (error instanceof DatabuddyApiError && error.status === 404) {
					return null;
				}
				throw error;
			}
		},
		async updateFlagRules(id, rules) {
			const body = await post("/flags/update", { id, rules });
			return databuddyFlagSchema.parse(body);
		},
		async query(input) {
			const body = await post(
				`/v1/query?website_id=${encodeURIComponent(config.websiteId)}`,
				{
					parameters: input.parameters,
					preset: input.preset ?? "last_90d",
					filters: input.filters ?? [],
					limit: input.limit ?? 20,
					timezone: "UTC",
				},
			);
			const parsed = databuddyQueryResultSchema.parse(body);
			const out: Record<string, DatabuddyQueryRow[]> = {};
			for (const entry of parsed.data ?? []) {
				if (entry.parameter) {
					out[entry.parameter] = entry.data ?? [];
				}
			}
			return out;
		},
	};
}
