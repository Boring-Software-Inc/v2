import { useMutation, useQuery } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { Alert, AlertTitle } from "@tripwire/ui/alert";
import { Button } from "@tripwire/ui/button";
import { notify } from "@tripwire/ui/toast";
import { PageTitle } from "@tripwire/ui/typography";
import { TripwireLogo } from "#/components/common/tripwire-logo";
import { InvitePageSkeleton } from "#/components/organizations/invite-page-skeleton";
import { sessionInfoQueryOptions } from "#/lib/auth.query";
import { redeemOrgInvite } from "#/lib/org.functions";

const route = getRouteApi("/invite/$token");

/**
 * /invite/$token (§6) — redeeming is an EXPLICIT act behind a button, never
 * fired on mount: a crawler prefetching the link must not consume a use. The
 * page states the token's implied action plainly and handles every redeem
 * outcome with honest copy.
 */
export function InvitePage() {
	const { token } = route.useParams();
	const navigate = useNavigate();

	const { data: session } = useQuery({
		...sessionInfoQueryOptions(),
		staleTime: 0,
	});

	const redeem = useMutation({
		mutationFn: () => redeemOrgInvite({ data: { token } }),
		onSuccess: (result) => {
			if (result.status === "joined") {
				notify.show({ title: "Joined the org" }, "success");
				navigate({ to: `/${result.orgSlug}/home` });
				return;
			}
			if (result.status === "already-member") {
				notify.show({ title: "You are already a member of this org" });
				navigate({ to: `/${result.orgSlug}/home` });
			}
		},
	});

	if (!session) {
		return <InvitePageSkeleton />;
	}

	// Signed out — or the redeem itself came back unauthenticated.
	if (!session.user || redeem.data?.status === "unauthenticated") {
		return (
			<InviteShell>
				<InviteCopy
					body="You have an invite to join an org on Tripwire. Sign in and Tripwire brings you back to this invite."
					title="Sign in to accept this invite"
				/>
				<Button
					href={`/login?redirect=${encodeURIComponent(`/invite/${token}`)}`}
					variant="primary"
				>
					Sign in
				</Button>
			</InviteShell>
		);
	}

	if (redeem.data?.status === "invalid") {
		return (
			<InviteShell>
				<InviteCopy
					body="Ask the person who sent it for a new invite link."
					title={INVALID_COPY[redeem.data.reason]}
				/>
				<Button href="/" variant="secondary">
					Back home
				</Button>
			</InviteShell>
		);
	}

	return (
		<InviteShell>
			<InviteCopy
				body="Joining adds you to the org as a member. Nothing changes until you choose Join org."
				title="You have an invite to join an org"
			/>
			<Button
				disabled={redeem.isSuccess}
				onAction={() => redeem.mutate()}
				pending={redeem.isPending}
				pendingLabel="Joining"
				reservePendingWidth
				type="button"
				variant="primary"
			>
				Join org
			</Button>
			{redeem.isError ? (
				<Alert data-layout-role="invite-error" role="alert" status="danger">
					<AlertTitle>
						Couldn't join the org. Check your connection and try again.
					</AlertTitle>
				</Alert>
			) : null}
		</InviteShell>
	);
}

const INVALID_COPY = {
	"not-found": "This invite link does not work",
	revoked: "An admin withdrew this invite",
	expired: "This invite has expired",
	exhausted: "This invite has no uses left",
} satisfies Record<"not-found" | "revoked" | "expired" | "exhausted", string>;

function InviteCopy({ title, body }: { title: string; body: string }) {
	return (
		<div className="flex flex-col items-center composition-gap-standard">
			<PageTitle>{title}</PageTitle>
			<p className="content-body tone-content-secondary">{body}</p>
		</div>
	);
}

function InviteShell({ children }: { children: React.ReactNode }) {
	return (
		<div
			className="flex min-h-dvh w-full items-center justify-center tone-surface-page"
			data-layout-role="invite-page"
		>
			<div
				className="flex w-full max-w-sm flex-col items-center text-center"
				data-layout-role="invite-content"
			>
				<TripwireLogo className="tone-content-primary" size={28} />
				{children}
			</div>
		</div>
	);
}
