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

type Row = Record<string, unknown>;

function pickString(row: Row, keys: readonly string[]): string | null {
	for (const key of keys) {
		const value = row[key];
		if (typeof value === "string" && value.trim() !== "") {
			return value;
		}
		if (typeof value === "number" && Number.isFinite(value)) {
			return String(value);
		}
	}
	return null;
}

function pickNumber(row: Row, keys: readonly string[]): number | null {
	for (const key of keys) {
		const value = row[key];
		if (typeof value === "number" && Number.isFinite(value)) {
			return value;
		}
		if (typeof value === "string" && value.trim() !== "") {
			const parsed = Number(value);
			if (Number.isFinite(parsed)) {
				return parsed;
			}
		}
	}
	return null;
}

export function summarizeProfile(
	rows: readonly Row[],
): DatabuddyProfileSummary | null {
	const row = rows[0];
	if (!row) {
		return null;
	}
	return {
		firstSeen: pickString(row, ["first_visit", "first_seen", "firstVisit"]),
		lastSeen: pickString(row, ["last_visit", "last_seen", "lastVisit"]),
		sessions: pickNumber(row, ["total_sessions", "session_count", "sessions"]),
		pageviews: pickNumber(row, ["total_pageviews", "pageviews", "page_views"]),
		country: pickString(row, ["country_name", "country"]),
		device: pickString(row, ["device_type", "device"]),
		browser: pickString(row, ["browser_name", "browser"]),
		os: pickString(row, ["os_name", "os"]),
	};
}

export function summarizeSessions(
	rows: readonly Row[],
	limit = 10,
): DatabuddySessionSummary[] {
	return rows.slice(0, limit).map((row, index) => ({
		id:
			pickString(row, ["session_id", "sessionId", "id"]) ?? `session-${index}`,
		startedAt: pickString(row, [
			"session_start",
			"first_visit",
			"started_at",
			"time",
		]),
		durationSeconds: pickNumber(row, ["duration", "session_duration"]),
		pageviews: pickNumber(row, ["page_views", "pageviews"]),
		entryPage: pickString(row, ["entry_page", "path", "first_path"]),
		country: pickString(row, ["country_name", "country"]),
		browser: pickString(row, ["browser_name", "browser"]),
		device: pickString(row, ["device_type", "device"]),
	}));
}
