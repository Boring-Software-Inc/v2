import { useMutation, useQueryClient } from "@tanstack/react-query";
import { orgSlugSchema, slugifyOrgName } from "@tripwire/contracts";
import { Dialog } from "@tripwire/ui/dialog";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
	Input,
} from "@tripwire/ui/field";
import { useState } from "react";
import { OrgAvatar } from "#/components/organizations/org-avatar";
import { createOrg } from "#/lib/org.functions";
import { orgQueryKeys } from "#/lib/org.query";

export function CreateOrgDialog({
	open,
	onOpenChange,
	onCreated,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onCreated: (slug: string) => void;
}) {
	return (
		<CreateOrgForm
			onCreated={onCreated}
			onOpenChange={onOpenChange}
			open={open}
		/>
	);
}

function CreateOrgForm({
	onCreated,
	onOpenChange,
	open,
}: {
	onCreated: (slug: string) => void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
}) {
	const queryClient = useQueryClient();
	const [name, setName] = useState("");
	const [slugOverride, setSlugOverride] = useState<string | null>(null);
	const [serverError, setServerError] = useState<string | null>(null);

	const slug = slugOverride ?? (name ? slugifyOrgName(name) : "");
	const slugCheck = slug ? orgSlugSchema.safeParse(slug) : null;
	const slugError =
		slugCheck && !slugCheck.success
			? (slugCheck.error.issues[0]?.message ??
				"Use lowercase letters, numbers and hyphens.")
			: null;

	const create = useMutation({
		mutationFn: () => createOrg({ data: { name: name.trim(), slug } }),
		onSuccess: (result) => {
			if ("error" in result) {
				setServerError(result.error);
				return;
			}
			queryClient.invalidateQueries({ queryKey: orgQueryKeys.all });
			onCreated(result.slug);
		},
	});

	const canSubmit =
		name.trim().length > 0 &&
		slug.length > 0 &&
		!slugError &&
		!create.isPending;

	return (
		<Dialog
			action={{
				disabled: !canSubmit,
				label: "Create org",
				onAction: async () => {
					setServerError(null);
					const result = await create.mutateAsync();
					if ("error" in result) throw new Error(result.error);
				},
				pendingLabel: "Creating",
			}}
			description="Name it after your team. You can rename it later."
			onOpenChange={onOpenChange}
			open={open}
			title="Create an org"
		>
			<form
				className="flex flex-col composition-gap-group"
				noValidate
				onSubmit={(event) => {
					event.preventDefault();
					if (canSubmit) {
						setServerError(null);
						create.mutate();
					}
				}}
			>
				<div className="flex items-end composition-gap-section">
					<OrgAvatar
						animate
						className="composition-bottom-small"
						name={name}
						size="lg"
					/>
					<div className="flex-1">
						<Field>
							<FieldLabel>Org name</FieldLabel>
							<Input
								autoComplete="off"
								autoFocus
								labelledByField
								onValueChange={setName}
								placeholder="Acme"
								value={name}
							/>
						</Field>
					</div>
				</div>

				<Field invalid={slugError !== null}>
					<FieldLabel>Slug</FieldLabel>
					<div className="content-mono">
						<Input
							autoComplete="off"
							labelledByField
							onValueChange={(value) => setSlugOverride(value.toLowerCase())}
							placeholder="acme"
							value={slug}
						/>
					</div>
					{slugError ? (
						<FieldError>{slugError}</FieldError>
					) : (
						<FieldDescription>
							{slug
								? `Your org's address: /${slug}/home`
								: "Used in your org's web address."}
						</FieldDescription>
					)}
				</Field>

				{serverError ? (
					<p className="content-body-small tone-danger" role="alert">
						{serverError}
					</p>
				) : null}
			</form>
		</Dialog>
	);
}
