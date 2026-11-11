import { BAN_REASON_MAX } from "@tripwire/contracts";
import { useState } from "react";
import { formatStaffDate } from "#/components/admin/user-sheet/format";
import { SheetSectionBlock } from "#/components/admin/user-sheet/sheet-parts";
import {
	errorText,
	useStaffAction,
} from "#/components/admin/user-sheet/use-staff-action";
import { ConfirmDeleteDialog } from "#/components/common/confirm-delete-dialog";
import { Button } from "#/design-system/ui/button";
import { Field, FieldError, FieldLabel } from "#/design-system/ui/field";
import { Input } from "#/design-system/ui/input";
import { Textarea } from "#/design-system/ui/textarea";
import {
	Body,
	Subheading,
	SupportingText,
} from "#/design-system/ui/typography";
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
			<div className="panel" data-layout-role="user-sheet-ban-form">
				<Subheading level={4}>Ban {user.name}</Subheading>
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
						data-layout-role="user-sheet-date-input"
						onValueChange={setEndsAt}
						type="date"
						value={endsAt}
					/>
				</Field>
			</div>
			<div className="shell-foot" data-layout-role="user-sheet-ban-actions">
				<Button onClick={onClose} size="sm" type="button" variant="secondary">
					Cancel
				</Button>
				<Button
					confirmation={false}
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
			<div data-layout-role="user-sheet-danger-list">
				{user.banned ? (
					<div data-layout-role="user-sheet-danger-row">
						<div>
							<span data-state-tone="danger">
								<Body as="span">
									Banned
									{user.banExpires
										? ` until ${formatStaffDate(user.banExpires)}`
										: " with no end date"}
								</Body>
							</span>
							{user.banReason ? (
								<SupportingText>{user.banReason}</SupportingText>
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
					<div data-layout-role="user-sheet-ban-form-slot">
						<BanForm onClose={() => onBanOpenChange(false)} view={view} />
					</div>
				) : (
					<div data-layout-role="user-sheet-danger-row">
						<Body as="span">Ban from Tripwire</Body>
						<Button
							confirmation={false}
							data-state-tone="danger"
							disabled={protectedUser}
							onClick={() => onBanOpenChange(true)}
							size="sm"
							variant="destructive"
						>
							Ban
						</Button>
					</div>
				)}
				<div data-layout-role="user-sheet-danger-row">
					<Body as="span">Delete account</Body>
					<Button
						confirmation={false}
						data-state-tone="danger"
						disabled={protectedUser}
						onClick={onDelete}
						size="sm"
						variant="destructive"
					>
						Delete account
					</Button>
				</div>
				{protectedUser ? (
					<SupportingText>
						{view.viewerId === user.id
							? "You cannot ban or delete yourself here."
							: "Remove their platform admin access before you ban or delete them."}
					</SupportingText>
				) : null}
			</div>
		</SheetSectionBlock>
	);
}
