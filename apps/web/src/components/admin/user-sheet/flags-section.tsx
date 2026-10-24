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
} from "#/components/glaze/icon";
import { Button } from "#/components/glaze/ui/button";
import { CopyButton } from "#/components/glaze/ui/copy-button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#/components/glaze/ui/dropdown-menu";
import {
	SegmentedControl,
	SegmentedControlItem,
} from "#/components/glaze/ui/segmented-control";
import { SkeletonText } from "#/components/glaze/ui/skeleton";
import { toast } from "#/components/glaze/ui/toast";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#/components/glaze/ui/tooltip";
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
	const color =
		tone === "warn"
			? "text-warn-text"
			: tone === "fail"
				? "text-fail-text"
				: "text-text-2";
	return (
		<span className={`flex items-center gap-1.5 type-caption ${color}`}>
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
		<ListRow className="sm:min-h-13">
			<span className="mono min-w-0 flex-1 basis-full truncate text-text-1 sm:basis-0">
				{row.key}
			</span>
			<span className="flex items-baseline gap-2 sm:w-30 sm:shrink-0 sm:flex-col sm:items-start sm:gap-0">
				{row.evaluated ? (
					<>
						<span className="type-label text-text-1">
							{row.evaluated.enabled ? "On" : "Off"}
						</span>
						<span className="type-caption text-text-2">
							{flagSourceLabel(row.evaluated.source, row.override)}
						</span>
					</>
				) : (
					<span className="type-caption text-text-2">Not evaluated</span>
				)}
			</span>
			<span className="order-last w-full sm:order-none sm:w-52 sm:shrink-0">
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
			<span className="ms-auto sm:ms-0 sm:w-28 sm:shrink-0">
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
				<div className="flex items-center gap-3">
					<QuietLine>Tripwire couldn't load the flags.</QuietLine>
					<Button onClick={() => void refetch()} size="sm" variant="secondary">
						Load flags again
					</Button>
				</div>
			) : (
				<>
					<div className="hidden min-h-7 items-center gap-4 border-line-faint border-b type-label-sm text-text-2 sm:flex">
						<span className="flex-1">Flag</span>
						<span className="w-30 shrink-0">For them</span>
						<span className="w-52 shrink-0">Override</span>
						<span className="w-28 shrink-0">Databuddy</span>
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
					<span className="mono min-w-0 truncate">{user.id}</span>
					<CopyButton
						label="Copy Databuddy profile id"
						size="icon-sm"
						value={user.id}
					/>
					<a
						className="inline-flex shrink-0 items-center gap-1 rounded-tag text-text-1 underline decoration-line-control underline-offset-3 hover:decoration-ink focus-visible:focus-ring"
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
							<span className="mono min-w-0 truncate">
								{user.databuddyAnonId}
							</span>
							<CopyButton
								label="Copy last anonymous id"
								size="icon-sm"
								value={user.databuddyAnonId}
							/>
						</>
					) : (
						<span className="text-text-2">None yet</span>
					)}
				</FieldRow>
			</FieldRows>
			{data && data.history.length > 0 ? (
				<div className="flex flex-col">
					<SubHeading title="History" />
					<ListRows label="Flag history">
						{data.history.map((entry) => (
							<ListRow key={entry.id}>
								<span className="min-w-0 flex-1 text-text-1">
									{historySentence(entry)}
								</span>
								<span className="shrink-0 type-caption text-text-2">
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
