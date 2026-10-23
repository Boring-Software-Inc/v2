import { createContext, type ReactNode, useContext } from "react";
import { useTimezones } from "#/hooks/use-timezones";
import { formatClockTime, formatDateTime } from "#/lib/timezones";

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
	format: "clock" | "date-time";
}) {
	const { display } = useTimezones(useContext(ZoneOrgContext));
	const instant = new Date(at);
	return (
		<time dateTime={at} suppressHydrationWarning>
			{format === "clock"
				? formatClockTime(instant, display.zone)
				: formatDateTime(instant, display.zone)}
		</time>
	);
}
