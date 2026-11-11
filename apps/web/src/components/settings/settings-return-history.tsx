import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

interface SettingsHistoryLocation {
	pathname: string;
	state: { __TSR_index: number };
}

interface SettingsReturnEntry {
	index: number;
}

const returnEntries = new Map<string, SettingsReturnEntry>();

function settingsOrg(pathname: string): string | null {
	return pathname.match(/^\/([^/]+)\/settings(?:\/|$)/)?.[1] ?? null;
}

export function rememberSettingsEntry(
	fromLocation: SettingsHistoryLocation | undefined,
	toLocation: SettingsHistoryLocation,
): void {
	const org = settingsOrg(toLocation.pathname);
	if (!org || !fromLocation || settingsOrg(fromLocation.pathname)) {
		return;
	}
	returnEntries.set(org, {
		index: fromLocation.state.__TSR_index,
	});
}

export function settingsReturnDelta(
	org: string,
	currentIndex: number,
): number | null {
	const entry = returnEntries.get(org);
	if (!entry || entry.index >= currentIndex) {
		return null;
	}
	return entry.index - currentIndex;
}

export function SettingsReturnHistory() {
	const router = useRouter();
	useEffect(
		() =>
			router.subscribe("onBeforeNavigate", ({ fromLocation, toLocation }) =>
				rememberSettingsEntry(fromLocation, toLocation),
			),
		[router],
	);
	return null;
}
