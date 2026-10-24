import {
	clearProfile,
	getAnonymousId,
	getProfileId,
	identify,
} from "@databuddy/sdk";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { sessionInfoQueryOptions } from "#/lib/auth.query";
import { recordDatabuddyAnonId } from "#/lib/staff-users.functions";
import { trackEvent } from "#/lib/track";

export function AnalyticsIdentity() {
	const { data } = useQuery(sessionInfoQueryOptions());
	const user = data?.user ?? null;
	const id = user?.id ?? null;
	const name = user?.name ?? null;
	const access = user?.accessStatus ?? null;
	const impersonating = Boolean(data?.impersonation);
	const sentAnonId = useRef<string | null>(null);

	useEffect(() => {
		if (id) {
			if (impersonating) {
				return;
			}
			if (getProfileId() !== id) {
				trackEvent("signed_in", {});
			}
			identify(id, name ? { name, access: access ?? "pending" } : undefined);
			const anonId = getAnonymousId();
			if (anonId && anonId !== sentAnonId.current) {
				sentAnonId.current = anonId;
				recordDatabuddyAnonId({ data: { anonId } }).catch(() => {
					sentAnonId.current = null;
				});
			}
			return;
		}
		if (data && getProfileId()) {
			clearProfile();
		}
	}, [data, id, name, access, impersonating]);

	return null;
}
