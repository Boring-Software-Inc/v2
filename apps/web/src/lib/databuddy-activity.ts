import type {
	DatabuddyProfileRow,
	DatabuddySessionRow,
} from "@tripwire/contracts";

export interface DatabuddyProfileSummary {
	firstSeen: string | null;
	lastSeen: string | null;
	sessions: number | null;
	pageviews: number | null;
	country: string | null;
	device: string | null;
	browser: string | null;
	os: string | null;
}

export interface DatabuddySessionSummary {
	id: string;
	startedAt: string | null;
	durationSeconds: number | null;
	pageviews: number | null;
	entryPage: string | null;
	country: string | null;
	browser: string | null;
	device: string | null;
}

const UTC_WITHOUT_ZONE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/;

export function databuddyTimeToIso(value: string | null | undefined) {
	if (!value) {
		return null;
	}
	return UTC_WITHOUT_ZONE.test(value) ? `${value.replace(" ", "T")}Z` : value;
}

export function summarizeProfile(
	row: DatabuddyProfileRow | null,
): DatabuddyProfileSummary | null {
	if (!row) {
		return null;
	}
	return {
		firstSeen: databuddyTimeToIso(row.first_visit),
		lastSeen: databuddyTimeToIso(row.last_visit),
		sessions: row.total_sessions ?? null,
		pageviews: row.total_pageviews ?? null,
		country: row.country_name ?? row.country ?? null,
		device: row.device_type ?? null,
		browser: row.browser_name ?? null,
		os: row.os_name ?? null,
	};
}

export function summarizeSessions(
	rows: readonly DatabuddySessionRow[],
): DatabuddySessionSummary[] {
	return rows.map((row, index) => ({
		id: row.session_id ?? `session-${index}`,
		startedAt: databuddyTimeToIso(row.session_start ?? row.first_visit),
		durationSeconds: row.duration ?? null,
		pageviews: row.page_views ?? null,
		entryPage: row.entry_page ?? row.path ?? null,
		country: row.country_name ?? row.country ?? null,
		browser: row.browser_name ?? null,
		device: row.device_type ?? null,
	}));
}
