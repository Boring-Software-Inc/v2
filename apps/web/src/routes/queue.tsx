import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AccessPendingScreen } from "#/components/auth/access-pending-screen";
import { toast } from "#/components/ui/sonner";
import { Spinner } from "#/components/ui/spinner";
import { sessionInfoQueryOptions } from "#/lib/auth.query";
import { buildSeo, formatPageTitle } from "#/lib/seo";

export const Route = createFileRoute("/queue")({
	component: QueuePage,
	head: ({ match }) =>
		buildSeo({
			path: match.pathname,
			title: formatPageTitle("Access queue"),
			description: "Your Tripwire access request status.",
			noindex: true,
		}),
});

function QueuePage() {
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
				toast("Still on the waitlist — we'll email you the moment you're in.");
			}
		} finally {
			setChecking(false);
		}
	};

	if (isLoading || !data?.user) {
		return (
			<div className="flex min-h-dvh w-full items-center justify-center bg-background">
				<Spinner className="text-muted-foreground" size={20} />
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
