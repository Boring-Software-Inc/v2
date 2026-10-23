import { useParams } from "@tanstack/react-router";
import { createContext, type ReactNode, useContext } from "react";
import { useTimezones } from "#/hooks/use-timezones";
import {
	formatClockTime,
	formatDateTime,
	formatShortTime,
} from "#/lib/timezones";

const ZoneOrgContext = createContext<string | undefined>(undefined);

export function ZoneOrgScope({
	org,
	children,
}: {
	org: string | undefined;
	children: ReactNode;
}) {
	return (
		<ZoneOrgContext.Provider value={org}>{children}</ZoneOrgContext.Provider>
	);
}

export function ZonedTime({
	at,
	format,
}: {
	at: string;
	format: "clock" | "date-time" | "short";
}) {
	const routeOrg = useParams({
		strict: false,
		select: (params) => params.org,
	});
	const { display } = useTimezones(useContext(ZoneOrgContext) ?? routeOrg);
	const instant = new Date(at);
	const text = {
		clock: formatClockTime,
		"date-time": formatDateTime,
		short: formatShortTime,
	}[format](instant, display.zone);
	return (
		<time dateTime={at} suppressHydrationWarning>
			{text}
		</time>
	);
}
