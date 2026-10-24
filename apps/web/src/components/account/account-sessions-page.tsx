import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MetaRow } from "#/components/common/meta-row";
import { SectionHeading } from "#/components/common/section-heading";
import { Badge } from "#/components/glaze/ui/badge";
import { Button } from "#/components/glaze/ui/button";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemTitle,
} from "#/components/glaze/ui/item";
import { SkeletonSwap, SkeletonText } from "#/components/glaze/ui/skeleton";
import { toast } from "#/components/glaze/ui/toast";
import { ZonedTime } from "#/components/timezones/zoned-time";
import {
	type AccountSession,
	revokeMyOtherSessions,
	revokeMySession,
} from "#/lib/account.functions";
import {
	accountQueryKeys,
	accountSessionsQueryOptions,
} from "#/lib/account.query";
import { describeUserAgent } from "#/lib/user-agent";

function SessionRow({ session }: { session: AccountSession }) {
	const queryClient = useQueryClient();
	const device = describeUserAgent(session.userAgent);
	const revoke = useMutation({
		mutationFn: () => revokeMySession({ data: { sessionId: session.id } }),
		onSuccess: () => toast.success(`Signed out ${device}`),
		onError: (error) => toast.fail(error.message),
		onSettled: () =>
			queryClient.invalidateQueries({ queryKey: accountQueryKeys.sessions() }),
	});
	return (
		<Item>
			<ItemContent>
				<ItemTitle>
					{device}
					{session.current ? <Badge size="sm">This device</Badge> : null}
				</ItemTitle>
				<ItemDescription>
					<MetaRow>
						<span>
							Signed in <ZonedTime at={session.createdAt} format="short" />
						</span>
						<span>
							Active <ZonedTime at={session.lastActiveAt} format="short" />
						</span>
					</MetaRow>
				</ItemDescription>
			</ItemContent>
			{session.current ? null : (
				<ItemActions>
					<Button
						aria-label={`Sign out ${device}`}
						onClick={() => revoke.mutate()}
						pending={revoke.isPending}
						pendingLabel="Signing out"
						size="sm"
						variant="ghost"
					>
						Sign out
					</Button>
				</ItemActions>
			)}
		</Item>
	);
}

const ROW_SLOTS = ["a", "b"] as const;

function SessionRowsSkeleton() {
	return (
		<ItemGroup aria-hidden variant="plain">
			{ROW_SLOTS.map((slot) => (
				<Item key={slot}>
					<ItemContent>
						<SkeletonText className="w-32" type="label" />
						<SkeletonText className="w-56" type="body-sm" />
					</ItemContent>
				</Item>
			))}
		</ItemGroup>
	);
}

export function AccountSessionsPage() {
	const queryClient = useQueryClient();
	const { data: sessions, isLoading } = useQuery(accountSessionsQueryOptions());
	const others = sessions?.filter((session) => !session.current).length ?? 0;
	const revokeOthers = useMutation({
		mutationFn: () => revokeMyOtherSessions(),
		onSuccess: () => toast.success("Signed out everywhere else"),
		onError: (error) => toast.fail(error.message),
		onSettled: () =>
			queryClient.invalidateQueries({ queryKey: accountQueryKeys.sessions() }),
	});
	return (
		<section
			aria-labelledby="account-sessions-heading"
			className="flex flex-col gap-3"
		>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<SectionHeading
					description="Where you are signed in."
					id="account-sessions-heading"
					title="Sessions"
				/>
				{others > 0 ? (
					<Button
						onClick={() => revokeOthers.mutate()}
						pending={revokeOthers.isPending}
						pendingLabel="Signing out"
						size="sm"
						variant="secondary"
					>
						Sign out everywhere else
					</Button>
				) : null}
			</div>
			<SkeletonSwap
				fallback={<SessionRowsSkeleton />}
				label="Loading sessions"
				loading={isLoading}
			>
				<ItemGroup aria-label="Sessions" variant="plain">
					{(sessions ?? []).map((session) => (
						<SessionRow key={session.id} session={session} />
					))}
				</ItemGroup>
			</SkeletonSwap>
		</section>
	);
}
