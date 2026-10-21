import { useMutation, useQueryClient } from "@tanstack/react-query";
import { orgSlugSchema, slugifyOrgName } from "@tripwire/contracts";
import { useId, useState } from "react";
import {
	Dialog,
	DialogAction,
	DialogBody,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/glaze/ui/dialog";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
} from "#/components/glaze/ui/field";
import { Input } from "#/components/glaze/ui/input";
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
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent size="sm">
				<DialogHeader>
					<DialogTitle>Create an org</DialogTitle>
					<DialogDescription>
						Name it after your team. You can rename it later.
					</DialogDescription>
				</DialogHeader>
				<CreateOrgForm onCreated={onCreated} />
			</DialogContent>
		</Dialog>
	);
}

function CreateOrgForm({ onCreated }: { onCreated: (slug: string) => void }) {
	const queryClient = useQueryClient();
	const formId = useId();
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
		<>
			<DialogBody>
				<form
					className="flex flex-col gap-4"
					id={formId}
					noValidate
					onSubmit={(event) => {
						event.preventDefault();
						if (canSubmit) {
							setServerError(null);
							create.mutate();
						}
					}}
				>
					<div className="flex items-end gap-3">
						<OrgAvatar animate className="mb-1" name={name} size="lg" />
						<Field className="flex-1">
							<FieldLabel>Org name</FieldLabel>
							<Input
								autoComplete="off"
								data-autofocus
								onValueChange={setName}
								placeholder="Acme"
								value={name}
							/>
						</Field>
					</div>

					<Field invalid={slugError !== null}>
						<FieldLabel>Slug</FieldLabel>
						<Input
							autoComplete="off"
							mono
							onValueChange={(value) => setSlugOverride(value.toLowerCase())}
							placeholder="acme"
							value={slug}
						/>
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
						<p className="type-body-sm text-fail-text" role="alert">
							{serverError}
						</p>
					) : null}
				</form>
			</DialogBody>
			<DialogFooter>
				<DialogClose>Cancel</DialogClose>
				<DialogAction
					close={false}
					disabled={!canSubmit}
					form={formId}
					pending={create.isPending}
					type="submit"
				>
					Create org
				</DialogAction>
			</DialogFooter>
		</>
	);
}
