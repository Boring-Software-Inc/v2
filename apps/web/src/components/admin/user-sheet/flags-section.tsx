import { useFlags } from "@databuddy/sdk/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import type { FlagOverrideChoice } from "@tripwire/contracts";
import { Button, IconButton } from "@tripwire/ui/button";
import { CopyButton } from "@tripwire/ui/copy-button";
import {
	Add,
	Check,
	External,
	Failed,
	Icon,
	Retry,
	Time,
} from "@tripwire/ui/icon";
import { Menu } from "@tripwire/ui/menu";
import { SegmentedControl } from "@tripwire/ui/radio-group";
import { SkeletonText } from "@tripwire/ui/skeleton";
import { notify } from "@tripwire/ui/toast";
import { Tooltip } from "@tripwire/ui/tooltip";
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
	const { refresh } = useFlags();
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
			notify.show(
				{ title: errorText(error, "Tripwire couldn't change this flag.") },
				"error",
			);
		},
		onSettled: () =>
			Promise.all([
				queryClient.invalidateQueries({ queryKey: key }),
				refresh(true),
			]),
	});
}

function useRetrySync(userId: string) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (flagKey: string) =>
			unwrapStaffAction(retryAdminUserFlagSync({ data: { userId, flagKey } })),
		onError: (error) =>
			notify.show(
				{ title: errorText(error, "Tripwire couldn't retry the sync.") },
				"error",
			),
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
				<Tooltip
					trigger={
						<IconButton
							disabled={retrying}
							icon={<Icon icon={Retry} />}
							label={`Retry the sync for ${row.key}`}
							onAction={onRetry}
							size="small"
							variant="ghost"
						/>
					}
				>
					{row.override?.syncError ?? "The sync failed"}
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
						<small>{flagSourceLabel(row.evaluated.source)}</small>
					</>
				) : (
					<small>Not evaluated</small>
				)}
			</span>
			<span data-layout-role="user-sheet-flag-control">
				<SegmentedControl
					ariaLabel={`Override for ${row.key}`}
					disabled={
						!connected ||
						row.inDatabuddy !== true ||
						row.override === null ||
						row.override.syncStatus === "pending"
					}
					onValueChange={(value) => {
						if (!value) return;
						const next = pickValue(CHOICES, value);
						if (next && next !== choice) {
							onChoose(next);
						}
					}}
					options={CHOICES.map((value) => ({
						label: CHOICE_LABEL[value],
						value,
					}))}
					value={choice}
				/>
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
	const { databuddyWebsiteId } = getRouteApi("__root__").useLoaderData();
	const { user } = view;
	const { data, isLoading, error, refetch } = useQuery(
		adminUserFlagsQueryOptions(user.id),
	);
	const override = useFlagOverride(user.id);
	const retry = useRetrySync(user.id);
	const connected = data?.connected ?? false;
	const flaggable = (data?.rows ?? []).filter(
		(row) =>
			row.inDatabuddy === true &&
			row.override?.syncStatus === "synced" &&
			row.override.choice !== "on",
	);
	const action = (
		<Menu
			align="end"
			ariaLabel="Flag in"
			items={flaggable.map((row) => ({
				label: row.key,
				onAction: () => override.mutate({ flagKey: row.key, choice: "on" }),
				type: "action" as const,
				value: row.key,
			}))}
			trigger={
				<Button
					disabled={!connected || flaggable.length === 0}
					size="small"
					variant="secondary"
				>
					<Icon icon={Add} />
					Flag in
				</Button>
			}
		/>
	);
	return (
		<SheetSectionBlock action={action} id="flags" title="Flags">
			{isLoading ? (
				<SkeletonText lines={3} type="body-sm" />
			) : error || !data ? (
				<div data-layout-role="user-sheet-inline-state">
					<QuietLine>Tripwire couldn't load the flags.</QuietLine>
					<Button
						onAction={() => void refetch()}
						size="small"
						variant="secondary"
					>
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
						size="small"
						value={user.id}
					/>
					<a
						data-layout-role="user-sheet-external-link"
						href={databuddyUserUrl(user.id, databuddyWebsiteId)}
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
								size="small"
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
