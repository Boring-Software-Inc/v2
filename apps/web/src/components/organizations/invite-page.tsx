import { useMutation, useQuery } from "@tanstack/react-query";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { TripwireLogo } from "#/components/common/tripwire-logo";
import { InvitePageSkeleton } from "#/components/organizations/invite-page-skeleton";
import { Button } from "#/components/ui/button";
import { Spinner } from "#/components/ui/spinner";
import { toast } from "#/components/ui/toast";
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
				toast.success("you're in");
				navigate({ to: `/${result.orgSlug}/home` });
				return;
			}
			if (result.status === "already-member") {
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
				<h1 className="font-semibold text-[17px] text-foreground">
					sign in to accept this invite
				</h1>
				<p className="text-[13px] text-muted-foreground leading-relaxed">
					you've been invited to join an org on tripwire. sign in with github,
					then come back to this link.
				</p>
				<Button
					nativeButton={false}
					render={
						<Link search={{ redirect: `/invite/${token}` }} to="/login" />
					}
					size="sm"
				>
					sign in
				</Button>
			</InviteShell>
		);
	}

	if (redeem.data?.status === "invalid") {
		return (
			<InviteShell>
				<h1 className="font-semibold text-[17px] text-foreground">
					{INVALID_COPY[redeem.data.reason]}
				</h1>
				<p className="text-[13px] text-muted-foreground leading-relaxed">
					ask whoever sent it for a fresh link.
				</p>
				<Button
					nativeButton={false}
					render={<Link to="/" />}
					size="sm"
					variant="outline"
				>
					back home
				</Button>
			</InviteShell>
		);
	}

	return (
		<InviteShell>
			<h1 className="font-semibold text-[17px] text-foreground">
				you've been invited to join an org.
			</h1>
			<p className="text-[13px] text-muted-foreground leading-relaxed">
				accepting adds you as a member. nothing happens until you do.
			</p>
			<Button
				disabled={redeem.isPending || redeem.isSuccess}
				iconLeft={redeem.isPending ? <Spinner size={14} /> : null}
				onClick={() => redeem.mutate()}
				size="sm"
				type="button"
			>
				{redeem.isPending ? "joining…" : "join org"}
			</Button>
			{redeem.isError ? (
				<p className="text-[12px] text-destructive">
					something broke — try again.
				</p>
			) : null}
		</InviteShell>
	);
}

const INVALID_COPY: Record<
	"not-found" | "revoked" | "expired" | "exhausted",
	string
> = {
	"not-found": "this invite doesn't exist.",
	revoked: "this invite was revoked.",
	expired: "this invite has expired.",
	exhausted: "this invite has no uses left.",
};

function InviteShell({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex min-h-dvh w-full items-center justify-center bg-background px-6">
			<div className="flex w-full max-w-sm flex-col items-center gap-6 text-center">
				<TripwireLogo className="text-foreground" size={28} />
				<div className="flex flex-col items-center gap-2.5">{children}</div>
			</div>
		</div>
	);
}
