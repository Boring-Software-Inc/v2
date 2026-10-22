import { clearProfile, getProfileId, identify } from "@databuddy/sdk";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { sessionInfoQueryOptions } from "#/lib/auth.query";

export function AnalyticsIdentity() {
	const { data } = useQuery(sessionInfoQueryOptions());
	const user = data?.user ?? null;
	const id = user?.id ?? null;
	const name = user?.name ?? null;

	useEffect(() => {
		if (id) {
			identify(id, name ? { name } : undefined);
			return;
		}
		if (data && getProfileId()) {
			clearProfile();
		}
	}, [data, id, name]);

	return null;
}
