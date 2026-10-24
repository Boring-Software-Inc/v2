import {
	type DatabuddyFlag,
	type DatabuddyProfileRow,
	type DatabuddySessionRow,
	databuddyErrorBodySchema,
	databuddyFlagListSchema,
	databuddyFlagSchema,
	databuddyProfileQuerySchema,
	databuddyProfileRowSchema,
	databuddySessionRowSchema,
	type JsonValue,
	parseJsonText,
} from "@tripwire/contracts";

export const DATABUDDY_API_URL = "https://api.databuddy.cc";

export interface DatabuddyApiConfig {
	apiKey: string;
	websiteId: string;
	baseUrl?: string;
	fetch?: typeof fetch;
	timeoutMs?: number;
}

export interface DatabuddyProfileActivity {
	profile: DatabuddyProfileRow | null;
	sessions: DatabuddySessionRow[];
}

export interface DatabuddyApi {
	listFlags(): Promise<DatabuddyFlag[]>;
	getFlagByKey(key: string): Promise<DatabuddyFlag | null>;
	updateFlagRules(id: string, rules: JsonValue[]): Promise<DatabuddyFlag>;
	profileActivity(
		profileId: string,
		limit?: number,
	): Promise<DatabuddyProfileActivity>;
}

export class DatabuddyApiError extends Error {
	readonly status: number;
	constructor(status: number, message: string) {
		super(message);
		this.name = "DatabuddyApiError";
		this.status = status;
	}
}

function messageOf(body: JsonValue | null, status: number): string {
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

	async function post(
		path: string,
		body: JsonValue,
	): Promise<JsonValue | null> {
		const response = await doFetch(`${base}${path}`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-api-key": config.apiKey,
			},
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(timeoutMs),
		});
		const parsed = parseJsonText(await response.text());
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
		async profileActivity(profileId, limit = 10) {
			const body = await post(
				`/v1/query?website_id=${encodeURIComponent(config.websiteId)}`,
				{
					parameters: ["profile_detail", "profile_sessions"],
					preset: "last_90d",
					filters: [{ field: "anonymous_id", op: "eq", value: profileId }],
					limit,
					timezone: "UTC",
				},
			);
			const result = databuddyProfileQuerySchema.parse(body);
			const rowsOf = (parameter: string) =>
				result.data?.find((entry) => entry.parameter === parameter)?.data ?? [];
			const profile = rowsOf("profile_detail")[0];
			return {
				profile:
					profile === undefined
						? null
						: databuddyProfileRowSchema.parse(profile),
				sessions: rowsOf("profile_sessions")
					.slice(0, limit)
					.map((row) => databuddySessionRowSchema.parse(row)),
			};
		},
	};
}
