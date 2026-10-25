import { BAN_REASON_MAX } from "@tripwire/contracts";
import { useState } from "react";
import { formatStaffDate } from "#/components/admin/user-sheet/format";
import { SheetSectionBlock } from "#/components/admin/user-sheet/sheet-parts";
import {
	errorText,
	useStaffAction,
} from "#/components/admin/user-sheet/use-staff-action";
import { ConfirmDeleteDialog } from "#/components/common/confirm-delete-dialog";
import { Button } from "#/components/glaze/ui/button";
import { Field, FieldError, FieldLabel } from "#/components/glaze/ui/field";
import { Input } from "#/components/glaze/ui/input";
import { Textarea } from "#/components/glaze/ui/textarea";
import {
	type AdminUserView,
	banAdminUser,
	deleteAdminUser,
	unbanAdminUser,
} from "#/lib/staff-users.functions";

function BanForm({
	view,
	onClose,
}: {
	view: AdminUserView;
	onClose: () => void;
}) {
	const { user } = view;
	const [reason, setReason] = useState("");
	const [endsAt, setEndsAt] = useState("");
	const [error, setError] = useState<string | null>(null);
	const ban = useStaffAction<{ reason: string; endsAt: string | null }>({
		userId: user.id,
		run: (value) => banAdminUser({ data: { userId: user.id, ...value } }),
		failure: `Tripwire couldn't ban ${user.name}.`,
		success: () => `Banned ${user.name} and ended their sessions`,
		toastErrors: false,
	});
	const submit = () => {
		const trimmed = reason.trim();
		if (!trimmed) {
			setError("Write why you are banning them.");
			return;
		}
		setError(null);
		ban.mutate(
			{ reason: trimmed, endsAt: endsAt || null },
			{
				onSuccess: onClose,
				onError: (failure) =>
					setError(errorText(failure, `Tripwire couldn't ban ${user.name}.`)),
			},
		);
	};
	return (
		<form
			aria-label={`Ban ${user.name}`}
			className="shell"
			onSubmit={(event) => {
				event.preventDefault();
				submit();
			}}
		>
			<div className="panel flex flex-col gap-4 p-4">
				<h4 className="type-label-lg text-text-1">Ban {user.name}</h4>
				<Field invalid={error !== null}>
					<FieldLabel>Reason</FieldLabel>
					<Textarea
						limit={BAN_REASON_MAX}
						onValueChange={setReason}
						rows={3}
						value={reason}
					/>
					{error ? <FieldError>{error}</FieldError> : null}
				</Field>
				<Field>
					<FieldLabel optional>Ends</FieldLabel>
					<Input
						className="w-full sm:w-55"
						onValueChange={setEndsAt}
						type="date"
						value={endsAt}
					/>
				</Field>
			</div>
			<div className="shell-foot justify-end">
				<Button onClick={onClose} size="sm" type="button" variant="secondary">
					Cancel
				</Button>
				<Button
					pending={ban.isPending}
					pendingLabel="Banning"
					size="sm"
					type="submit"
					variant="destructive"
				>
					Ban and sign out
				</Button>
			</div>
		</form>
	);
}

export function DeleteUserDialog({
	view,
	open,
	onOpenChange,
	onDeleted,
}: {
	view: AdminUserView;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onDeleted: () => void;
}) {
	const { user } = view;
	const confirmText = user.login ?? user.name;
	const remove = useStaffAction<void>({
		userId: user.id,
		run: () =>
			deleteAdminUser({ data: { userId: user.id, confirm: confirmText } }),
		failure: `Tripwire couldn't delete ${user.name}.`,
		success: () => `Deleted ${user.name}`,
		scope: "list",
		toastErrors: false,
	});
	return (
		<ConfirmDeleteDialog
			actionLabel="Delete account"
			confirmText={confirmText}
			description="This also deletes their personal org."
			onConfirm={async () => {
				await remove.mutateAsync();
				onDeleted();
			}}
			onOpenChange={onOpenChange}
			open={open}
			title={`Delete ${confirmText}?`}
		/>
	);
}

export function DangerSection({
	view,
	banOpen,
	onBanOpenChange,
	onDelete,
}: {
	view: AdminUserView;
	banOpen: boolean;
	onBanOpenChange: (open: boolean) => void;
	onDelete: () => void;
}) {
	const { user } = view;
	const unban = useStaffAction<void>({
		userId: user.id,
		run: () => unbanAdminUser({ data: { userId: user.id } }),
		failure: `Tripwire couldn't unban ${user.name}.`,
		success: () => `Unbanned ${user.name}`,
	});
	const protectedUser = user.isPlatformAdmin || view.viewerId === user.id;
	return (
		<SheetSectionBlock id="danger" title="Danger">
			<div className="flex flex-col">
				{user.banned ? (
					<div className="flex min-h-13 flex-wrap items-center justify-between gap-3 border-line-faint border-b py-2">
						<div className="flex min-w-0 flex-col">
							<span className="type-body-sm text-fail-text">
								Banned
								{user.banExpires
									? ` until ${formatStaffDate(user.banExpires)}`
									: " with no end date"}
							</span>
							{user.banReason ? (
								<span className="type-body-sm text-text-2">
									{user.banReason}
								</span>
							) : null}
						</div>
						<Button
							disabled={unban.isPending}
							onClick={() => unban.mutate()}
							size="sm"
							variant="secondary"
						>
							Unban
						</Button>
					</div>
				) : banOpen ? (
					<div className="mb-3">
						<BanForm onClose={() => onBanOpenChange(false)} view={view} />
					</div>
				) : (
					<div className="flex min-h-13 items-center justify-between gap-3 border-line-faint border-b">
						<span className="type-body-sm text-text-1">Ban from Tripwire</span>
						<Button
							className="text-fail-text"
							disabled={protectedUser}
							onClick={() => onBanOpenChange(true)}
							size="sm"
							variant="secondary"
						>
							Ban
						</Button>
					</div>
				)}
				<div className="flex min-h-13 items-center justify-between gap-3">
					<span className="type-body-sm text-text-1">Delete account</span>
					<Button
						className="text-fail-text"
						disabled={protectedUser}
						onClick={onDelete}
						size="sm"
						variant="secondary"
					>
						Delete account
					</Button>
				</div>
				{protectedUser ? (
					<p className="type-caption text-text-2">
						{view.viewerId === user.id
							? "You cannot ban or delete yourself here."
							: "Remove their platform admin access before you ban or delete them."}
					</p>
				) : null}
			</div>
		</SheetSectionBlock>
	);
}
