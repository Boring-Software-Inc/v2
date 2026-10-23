import { useRouter } from "@tanstack/react-router";
import { createContext, type ReactNode, useContext } from "react";
import { z } from "zod";
import { useTimezones } from "#/hooks/use-timezones";
import {
	formatClockTime,
	formatDateTime,
	formatShortTime,
} from "#/lib/timezones";

const orgParamSchema = z.object({ org: z.string() });

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
	const router = useRouter({ warn: false });
	const routeOrg = orgParamSchema.safeParse(
		router?.state.matches.at(-1)?.params,
	);
	const { display } = useTimezones(
		useContext(ZoneOrgContext) ??
			(routeOrg.success ? routeOrg.data.org : undefined),
	);
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
