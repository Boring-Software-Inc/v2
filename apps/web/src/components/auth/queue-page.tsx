import { useQuery } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { Status } from "@tripwire/ui/status";
import { notify } from "@tripwire/ui/toast";
import { useEffect, useState } from "react";
import { AccessPendingScreen } from "#/components/auth/access-pending-screen";
import { sessionInfoQueryOptions } from "#/lib/auth.query";

import "./auth-page-status.css";

export function QueuePage() {
	const router = useRouter();
	const [checking, setChecking] = useState(false);
	const { data, isLoading, refetch } = useQuery({
		...sessionInfoQueryOptions(),
		staleTime: 15_000,
	});

	useEffect(() => {
		if (!data) return;
		if (!data.user) {
			router.navigate({ to: "/login" });
			return;
		}
		// Approved users have no business on the queue — send them onward.
		if (data.user.accessStatus === "approved") {
			router.navigate({ to: "/" });
		}
	}, [data, router]);

	// Manual re-check: getSessionInfo reads accessStatus fresh from the DB, so a
	// forced refetch surfaces an approval granted since page load without a
	// re-login. The effect above navigates once the status flips to approved.
	const handleCheck = async () => {
		setChecking(true);
		try {
			const { data: fresh } = await refetch();
			if (fresh?.user?.accessStatus === "approved") {
				router.navigate({ to: "/" });
			} else {
				notify.show({
					title:
						"You are still on the waitlist. We email you when you are approved.",
				});
			}
		} finally {
			setChecking(false);
		}
	};

	if (isLoading || !data?.user) {
		return (
			<div data-layout-role="auth-page-status">
				<Status status="running">Checking access</Status>
			</div>
		);
	}

	return (
		<AccessPendingScreen
			email={data.user.email}
			image={data.user.image}
			status={data.user.accessStatus}
			onCheck={handleCheck}
			checking={checking}
		/>
	);
}
