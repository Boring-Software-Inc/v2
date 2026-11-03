import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FlagOverrideChoice } from "@tripwire/contracts";
import { formatStaffDateTime } from "#/components/admin/user-sheet/format";
import {
	FieldRow,
	FieldRows,
	ListRow,
	ListRows,
	QuietLine,
	SheetSectionBlock,
	SubHeading,
} from "#/components/admin/user-sheet/sheet-parts";
import {
	errorText,
	unwrapStaffAction,
} from "#/components/admin/user-sheet/use-staff-action";
import {
	Add,
	Check,
	External,
	Failed,
	Icon,
	Retry,
	Time,
} from "#/design-system/icon";
import { Button } from "#/design-system/ui/button";
import { CopyButton } from "#/design-system/ui/copy-button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#/design-system/ui/dropdown-menu";
import {
	SegmentedControl,
	SegmentedControlItem,
} from "#/design-system/ui/segmented-control";
import { SkeletonText } from "#/design-system/ui/skeleton";
import { toast } from "#/design-system/ui/toast";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#/design-system/ui/tooltip";
import {
	databuddyUserUrl,
	flagSourceLabel,
	flagSyncLabel,
	historySentence,
} from "#/lib/admin-user-sheet";
import { pickValue } from "#/lib/pick-value";
import {
	type AdminUserFlagRow,
	type AdminUserFlagsView,
	type AdminUserView,
	retryAdminUserFlagSync,
	setAdminUserFlagOverride,
} from "#/lib/staff-users.functions";
import {
	adminUserFlagsQueryOptions,
	staffUserQueryKeys,
} from "#/lib/staff-users.query";

const CHOICES = ["default", "on", "off"] as const;

const CHOICE_LABEL = {
	default: "Default",
	on: "On",
	off: "Off",
} satisfies Record<FlagOverrideChoice, string>;

function useFlagOverride(userId: string) {
	const queryClient = useQueryClient();
	const key = staffUserQueryKeys.flags(userId);
	return useMutation({
		mutationFn: (input: { flagKey: string; choice: FlagOverrideChoice }) =>
			unwrapStaffAction(
				setAdminUserFlagOverride({ data: { userId, ...input } }),
			),
		onMutate: async (input) => {
			await queryClient.cancelQueries({ queryKey: key });
			const previous = queryClient.getQueryData<AdminUserFlagsView>(key);
			if (previous) {
				queryClient.setQueryData<AdminUserFlagsView>(key, {
					...previous,
					rows: previous.rows.map((row) =>
						row.key === input.flagKey
							? {
									...row,
									override: {
										choice: input.choice,
										syncStatus: "pending",
										syncError: null,
										syncedAt: row.override?.syncedAt ?? null,
									},
								}
							: row,
					),
				});
			}
			return { previous };
		},
		onError: (error, _input, context) => {
			if (context?.previous) {
				queryClient.setQueryData(key, context.previous);
			}
			toast.fail(errorText(error, "Tripwire couldn't change this flag."));
		},
		onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
	});
}

function useRetrySync(userId: string) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (flagKey: string) =>
			unwrapStaffAction(retryAdminUserFlagSync({ data: { userId, flagKey } })),
		onError: (error) =>
			toast.fail(errorText(error, "Tripwire couldn't retry the sync.")),
		onSettled: () =>
			queryClient.invalidateQueries({
				queryKey: staffUserQueryKeys.flags(userId),
			}),
	});
}

function SyncCell({
	row,
	connected,
	onRetry,
	retrying,
}: {
	row: AdminUserFlagRow;
	connected: boolean;
	onRetry: () => void;
	retrying: boolean;
}) {
	const { tone, label } = flagSyncLabel({
		connected,
		inDatabuddy: row.inDatabuddy,
		syncStatus: row.override?.syncStatus ?? null,
	});
	const glyph =
		tone === "ok"
			? Check
			: tone === "warn"
				? Time
				: tone === "fail"
					? Failed
					: null;
	return (
		<span data-layout-role="user-sheet-sync" data-state-tone={tone}>
			{glyph ? <Icon icon={glyph} size={12} /> : null}
			<span>{label}</span>
			{tone === "fail" ? (
				<Tooltip>
					<TooltipTrigger
						render={
							<Button
								aria-label={`Retry the sync for ${row.key}`}
								disabled={retrying}
								onClick={onRetry}
								size="icon-sm"
								variant="ghost"
							/>
						}
					>
						<Icon icon={Retry} />
					</TooltipTrigger>
					<TooltipContent>
						{row.override?.syncError ?? "The sync failed"}
					</TooltipContent>
				</Tooltip>
			) : null}
		</span>
	);
}

function FlagRow({
	row,
	connected,
	onChoose,
	onRetry,
	retrying,
}: {
	row: AdminUserFlagRow;
	connected: boolean;
	onChoose: (choice: FlagOverrideChoice) => void;
	onRetry: () => void;
	retrying: boolean;
}) {
	const choice = row.override?.choice ?? "default";
	return (
		<ListRow>
			<span data-layout-role="user-sheet-flag-name">{row.key}</span>
			<span data-layout-role="user-sheet-flag-value">
				{row.evaluated ? (
					<>
						<strong>{row.evaluated.enabled ? "On" : "Off"}</strong>
						<small>{flagSourceLabel(row.evaluated.source, row.override)}</small>
					</>
				) : (
					<small>Not evaluated</small>
				)}
			</span>
			<span data-layout-role="user-sheet-flag-control">
				<SegmentedControl
					aria-label={`Override for ${row.key}`}
					disabled={!connected}
					fill
					onValueChange={(value) => {
						const next = pickValue(CHOICES, value);
						if (next && next !== choice) {
							onChoose(next);
						}
					}}
					size="sm"
					value={choice}
				>
					{CHOICES.map((value) => (
						<SegmentedControlItem key={value} value={value}>
							{CHOICE_LABEL[value]}
						</SegmentedControlItem>
					))}
				</SegmentedControl>
			</span>
			<span data-layout-role="user-sheet-flag-sync">
				<SyncCell
					connected={connected}
					onRetry={onRetry}
					retrying={retrying}
					row={row}
				/>
			</span>
		</ListRow>
	);
}

export function FlagsSection({ view }: { view: AdminUserView }) {
	const { user } = view;
	const { data, isLoading, error, refetch } = useQuery(
		adminUserFlagsQueryOptions(user.id),
	);
	const override = useFlagOverride(user.id);
	const retry = useRetrySync(user.id);
	const connected = data?.connected ?? false;
	const flaggable = (data?.rows ?? []).filter(
		(row) => row.override?.choice !== "on",
	);
	const action = (
		<DropdownMenu>
			<DropdownMenuTrigger
				disabled={!connected || flaggable.length === 0}
				render={<Button size="sm" variant="secondary" />}
			>
				<Icon icon={Add} />
				Flag in
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" size="sm">
				{flaggable.map((row) => (
					<DropdownMenuItem
						key={row.key}
						onClick={() => override.mutate({ flagKey: row.key, choice: "on" })}
					>
						<span className="mono">{row.key}</span>
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
	return (
		<SheetSectionBlock action={action} id="flags" title="Flags">
			{isLoading ? (
				<SkeletonText lines={3} type="body-sm" />
			) : error || !data ? (
				<div data-layout-role="user-sheet-inline-state">
					<QuietLine>Tripwire couldn't load the flags.</QuietLine>
					<Button onClick={() => void refetch()} size="sm" variant="secondary">
						Load flags again
					</Button>
				</div>
			) : (
				<>
					<div data-layout-role="user-sheet-flag-head">
						<span>Flag</span>
						<span>For them</span>
						<span>Override</span>
						<span>Databuddy</span>
					</div>
					<ListRows label="Flags">
						{data.rows.map((row) => (
							<FlagRow
								connected={connected}
								key={row.key}
								onChoose={(choice) =>
									override.mutate({ flagKey: row.key, choice })
								}
								onRetry={() => retry.mutate(row.key)}
								retrying={retry.isPending && retry.variables === row.key}
								row={row}
							/>
						))}
					</ListRows>
					{data.listError ? (
						<QuietLine>
							Databuddy flags did not load: {data.listError}
						</QuietLine>
					) : null}
				</>
			)}
			<FieldRows>
				<FieldRow label="Databuddy profile">
					<span data-layout-role="user-sheet-mono-value">{user.id}</span>
					<CopyButton
						label="Copy Databuddy profile id"
						size="icon-sm"
						value={user.id}
					/>
					<a
						data-layout-role="user-sheet-external-link"
						href={databuddyUserUrl(user.id)}
						rel="noreferrer"
						target="_blank"
					>
						Open in Databuddy
						<Icon icon={External} size={12} />
					</a>
				</FieldRow>
				<FieldRow label="Last anonymous id">
					{user.databuddyAnonId ? (
						<>
							<span data-layout-role="user-sheet-mono-value">
								{user.databuddyAnonId}
							</span>
							<CopyButton
								label="Copy last anonymous id"
								size="icon-sm"
								value={user.databuddyAnonId}
							/>
						</>
					) : (
						<span data-layout-role="user-sheet-muted-value">None yet</span>
					)}
				</FieldRow>
			</FieldRows>
			{data && data.history.length > 0 ? (
				<div data-layout-role="user-sheet-subsection">
					<SubHeading title="History" />
					<ListRows label="Flag history">
						{data.history.map((entry) => (
							<ListRow key={entry.id}>
								<span data-layout-role="user-sheet-list-main">
									{historySentence(entry)}
								</span>
								<span data-layout-role="user-sheet-list-meta">
									{formatStaffDateTime(entry.createdAt)}
								</span>
							</ListRow>
						))}
					</ListRows>
				</div>
			) : null}
		</SheetSectionBlock>
	);
}
