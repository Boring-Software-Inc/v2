import { useQuery } from "@tanstack/react-query";
import { DEFAULT_SCHEDULE_TIMEZONE } from "@tripwire/contracts";
import { useSyncExternalStore } from "react";
import { sessionInfoQueryOptions } from "#/lib/auth.query";
import { orgContextQueryOptions } from "#/lib/org.query";
import {
	type DisplayZone,
	deviceTimezone,
	newScheduleTimezone,
	resolveDisplayZone,
} from "#/lib/timezones";

function subscribe(): () => void {
	return () => undefined;
}

export function useDeviceTimezone(): string {
	return useSyncExternalStore(
		subscribe,
		deviceTimezone,
		() => DEFAULT_SCHEDULE_TIMEZONE,
	);
}

export interface Timezones {
	display: DisplayZone;
	account: string | null;
	org: string | null;
	newSchedule: string | undefined;
}

export function useTimezones(org: string | undefined): Timezones {
	const device = useDeviceTimezone();
	const { data: account = null } = useQuery({
		...sessionInfoQueryOptions(),
		select: (session) => session.user?.timezone ?? null,
	});
	const { data: orgZone = null } = useQuery({
		...orgContextQueryOptions(org ?? ""),
		enabled: Boolean(org),
		select: (context) => context.timezone,
	});
	return {
		display: resolveDisplayZone({ account, org: orgZone, device }),
		account,
		org: orgZone,
		newSchedule: newScheduleTimezone({ org: orgZone, account }),
	};
}
