import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { DeleteAccountDialog } from "#/components/account/delete-account-dialog";
import { SectionHeading } from "#/components/common/section-heading";
import { Avatar } from "#/components/glaze/ui/avatar";
import { Button } from "#/components/glaze/ui/button";
import {
	Skeleton,
	SkeletonSwap,
	SkeletonText,
} from "#/components/glaze/ui/skeleton";
import { toast } from "#/components/glaze/ui/toast";
import { TimezonePicker } from "#/components/timezones/timezone-picker";
import { useDeviceTimezone } from "#/hooks/use-timezones";
import type { CurrentUser } from "#/lib/auth.functions";
import { authQueryKeys, sessionInfoQueryOptions } from "#/lib/auth.query";
import { setAccountTimezone } from "#/lib/timezone.functions";

export function AccountGeneralPage({
	user,
	onLeave,
}: {
	user: CurrentUser;
	onLeave: () => void;
}) {
	const { data: session } = useQuery(sessionInfoQueryOptions());

	return (
		<SkeletonSwap
			fallback={<AccountGeneralPageSkeleton />}
			label="Loading account settings"
			loading={!session}
		>
			{session ? (
				<div className="flex flex-col gap-8">
					<ProfileSection user={user} />
					<TimezoneSection timezone={session.user?.timezone ?? null} />
					<DeleteAccountSection onLeave={onLeave} />
				</div>
			) : null}
		</SkeletonSwap>
	);
}

function ProfileSection({ user }: { user: CurrentUser }) {
	return (
		<section
			aria-labelledby="account-profile-heading"
			className="flex flex-col gap-3"
		>
			<SectionHeading
				description="From the account you signed in with."
				id="account-profile-heading"
				title="Profile"
			/>
			<div className="flex items-center gap-3">
				<Avatar
					className="size-12"
					decorative
					name={user.name}
					size="lg"
					src={user.image || undefined}
				/>
				<div className="flex min-w-0 flex-col">
					<p className="truncate type-label">{user.name}</p>
					{user.login !== user.name ? (
						<p className="truncate type-code-sm text-text-2">@{user.login}</p>
					) : null}
					{user.email ? (
						<p className="truncate type-body-sm text-text-2">{user.email}</p>
					) : null}
				</div>
			</div>
		</section>
	);
}

function TimezoneSection({ timezone }: { timezone: string | null }) {
	const queryClient = useQueryClient();
	const device = useDeviceTimezone();
	const save = useMutation({
		mutationFn: (next: string | null) =>
			setAccountTimezone({ data: { timezone: next } }),
		onSuccess: () => toast.success("Timezone saved"),
		onError: () =>
			toast.fail("Tripwire could not save the timezone. Try again."),
		onSettled: () =>
			queryClient.invalidateQueries({ queryKey: authQueryKeys.session() }),
	});
	return (
		<section
			aria-labelledby="account-timezone-heading"
			className="flex max-w-md flex-col gap-3"
		>
			<SectionHeading
				description="Every time Tripwire shows you uses this zone."
				id="account-timezone-heading"
				title="Timezone"
			/>
			<TimezonePicker
				disabled={save.isPending}
				labelledBy="account-timezone-heading"
				onChange={(next) => save.mutate(next)}
				unsetLabel={`Org timezone, or this device (${device})`}
				value={timezone}
			/>
		</section>
	);
}

function DeleteAccountSection({ onLeave }: { onLeave: () => void }) {
	const [open, setOpen] = useState(false);
	return (
		<section
			aria-labelledby="account-delete-heading"
			className="flex flex-col items-start gap-3"
		>
			<SectionHeading
				description="Deletes your account and your personal org. This can't be undone."
				id="account-delete-heading"
				title="Delete account"
			/>
			<Button onClick={() => setOpen(true)} size="sm" variant="secondary">
				Delete account
			</Button>
			<DeleteAccountDialog
				onLeave={onLeave}
				onOpenChange={setOpen}
				open={open}
			/>
		</section>
	);
}

export function AccountGeneralPageSkeleton() {
	return (
		<div aria-hidden className="flex flex-col gap-8">
			<div className="flex flex-col gap-3">
				<div className="flex flex-col gap-0.5">
					<SkeletonText className="w-20" type="heading-sm" />
					<SkeletonText className="w-60" type="body-sm" />
				</div>
				<div className="flex items-center gap-3">
					<Skeleton className="size-12 rounded-full" />
					<div className="flex flex-col gap-1">
						<SkeletonText className="w-32" type="label" />
						<SkeletonText className="w-24" type="code-sm" />
					</div>
				</div>
			</div>
			<div className="flex max-w-md flex-col gap-3">
				<div className="flex flex-col gap-0.5">
					<SkeletonText className="w-20" type="heading-sm" />
					<SkeletonText className="w-60" type="body-sm" />
				</div>
				<Skeleton className="h-(--control) w-full rounded-pill" />
			</div>
		</div>
	);
}
