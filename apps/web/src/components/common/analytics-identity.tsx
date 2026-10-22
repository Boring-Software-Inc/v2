import { clearProfile, getProfileId, identify } from "@databuddy/sdk";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { sessionInfoQueryOptions } from "#/lib/auth.query";
import { trackEvent } from "#/lib/track";

export function AnalyticsIdentity() {
	const { data } = useQuery(sessionInfoQueryOptions());
	const user = data?.user ?? null;
	const id = user?.id ?? null;
	const name = user?.name ?? null;
	const access = user?.accessStatus ?? null;

	useEffect(() => {
		if (id) {
			if (getProfileId() !== id) {
				trackEvent("signed_in", {});
			}
			identify(id, name ? { name, access: access ?? "pending" } : undefined);
			return;
		}
		if (data && getProfileId()) {
			clearProfile();
		}
	}, [data, id, name, access]);

	return null;
}
