import { useMutation } from "@tanstack/react-query";
import { orgSlugSchema, slugifyOrgName } from "@tripwire/contracts";
import { useId, useState } from "react";
import { Button } from "#/components/glaze/ui/button";
import {
	Card,
	CardContent,
	CardFooter,
	CardMeta,
} from "#/components/glaze/ui/card";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
} from "#/components/glaze/ui/field";
import { Input } from "#/components/glaze/ui/input";
import { OrgAvatar } from "#/components/organizations/org-avatar";
import { createOrg } from "#/lib/org.functions";

/**
 * `/` when the caller has no orgs (open-dev edge) — create the first one.
 * §7: the avatar is DERIVED from the name and regenerates live as they type;
 * the slug is auto-suggested but stays editable. On success we hard-navigate
 * so the whole session picks up the new org.
 */
export function NoOrgsPage() {
	const headingId = useId();
	const [name, setName] = useState("");
	const [slugDraft, setSlugDraft] = useState<string | null>(null);
	const slug = slugDraft ?? slugifyOrgName(name);
	const slugCheck = orgSlugSchema.safeParse(slug);
	const slugError =
		slug.length > 0 && !slugCheck.success
			? (slugCheck.error?.issues[0]?.message ?? "Invalid slug")
			: null;

	const create = useMutation({
		mutationFn: () => createOrg({ data: { name: name.trim(), slug } }),
		onSuccess: (result) => {
			if ("slug" in result) {
				window.location.assign(`/${result.slug}/home`);
			}
		},
	});
	const serverError =
		create.data && "error" in create.data ? create.data.error : null;

	const canSubmit = name.trim().length > 0 && slugCheck.success;

	return (
		<div className="flex min-h-dvh items-center justify-center bg-page px-4 py-10">
			<div className="flex w-full max-w-sm flex-col gap-6">
				<div className="flex flex-col gap-1">
					<h1 className="type-title" id={headingId}>
						Create your first org
					</h1>
					<p className="type-body text-text-2">
						Everything in Tripwire lives inside an org.
					</p>
				</div>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						if (canSubmit && !create.isPending) {
							create.mutate();
						}
					}}
				>
					<Card aria-labelledby={headingId} role="group">
						<CardContent className="gap-4">
							<Field>
								<FieldLabel>Name</FieldLabel>
								<Input
									autoFocus
									leading={<OrgAvatar name={name} size="xs" />}
									onChange={(event) => setName(event.target.value)}
									placeholder="Acme"
									value={name}
								/>
							</Field>
							<Field invalid={slugError !== null}>
								<FieldLabel>Slug</FieldLabel>
								<Input
									mono
									onChange={(event) =>
										setSlugDraft(event.target.value.toLowerCase())
									}
									placeholder="acme"
									value={slug}
								/>
								{slugError ? (
									<FieldError>{slugError}</FieldError>
								) : (
									<FieldDescription>
										Your org's URL: /{slug || "…"}
									</FieldDescription>
								)}
							</Field>
						</CardContent>
						<CardFooter>
							{serverError ? (
								<CardMeta className="text-fail-text" role="alert">
									{serverError}
								</CardMeta>
							) : null}
							<Button
								disabled={!canSubmit}
								pending={create.isPending}
								pendingLabel="Creating"
								size="sm"
								type="submit"
							>
								Create org
							</Button>
						</CardFooter>
					</Card>
				</form>
			</div>
		</div>
	);
}
