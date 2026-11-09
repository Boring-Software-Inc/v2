import { DATABUDDY_WEBSITE_ID } from "@tripwire/contracts";
import type { DatabuddyApiConfig } from "./databuddy-api.ts";

/** Only an absent variable uses the production default; explicit values are not rewritten. */
export function getDatabuddyWebsiteId(): string {
	return process.env.DATABUDDY_WEBSITE_ID ?? DATABUDDY_WEBSITE_ID;
}

export function getDatabuddyApiConfig(): DatabuddyApiConfig | null {
	const apiKey = process.env.DATABUDDY_API_KEY;
	return apiKey
		? {
				apiKey,
				websiteId: getDatabuddyWebsiteId(),
				baseUrl: process.env.DATABUDDY_API_URL,
			}
		: null;
}
