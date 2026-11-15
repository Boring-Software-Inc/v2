import { useMutation } from "@tanstack/react-query";
import { orgSlugSchema, slugifyOrgName } from "@tripwire/contracts";
import { Button } from "@tripwire/ui/button";
import { Card, CardContent, CardFooter, CardMeta } from "@tripwire/ui/card";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
	Input,
} from "@tripwire/ui/field";
import { PageTitle } from "@tripwire/ui/typography";
import { useId, useState } from "react";
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
			? (slugCheck.error?.issues[0]?.message ??
				"Use lowercase letters, numbers and hyphens.")
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

	const [nameMissing, setNameMissing] = useState(false);
	const canSubmit = name.trim().length > 0 && slugCheck.success;

	return (
		<div
			className="flex min-h-dvh items-center justify-center tone-surface-page"
			data-layout-role="first-org-page"
		>
			<div
				className="flex w-full max-w-sm flex-col"
				data-layout-role="first-org-content"
			>
				<div className="flex flex-col composition-gap-small">
					<PageTitle id={headingId}>Create your first org</PageTitle>
					<p className="content-body tone-content-secondary">
						An org holds your repos, rules and members.
					</p>
				</div>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						if (name.trim().length === 0) {
							setNameMissing(true);
							return;
						}
						if (canSubmit && !create.isPending) {
							create.mutate();
						}
					}}
				>
					<Card aria-labelledby={headingId} role="group">
						<CardContent>
							<div className="flex flex-col composition-gap-group">
								<Field invalid={nameMissing}>
									<FieldLabel>Name</FieldLabel>
									<Input
										autoFocus
										labelledByField
										leadingIcon={<OrgAvatar animate name={name} size="xs" />}
										onChange={(event) => {
											setName(event.target.value);
											if (nameMissing) setNameMissing(false);
										}}
										placeholder="Acme"
										value={name}
									/>
									{nameMissing ? (
										<FieldError>Enter a name for your org.</FieldError>
									) : null}
								</Field>
								<Field invalid={slugError !== null}>
									<FieldLabel>Slug</FieldLabel>
									<div className="content-mono">
										<Input
											labelledByField
											onChange={(event) =>
												setSlugDraft(event.target.value.toLowerCase())
											}
											placeholder="acme"
											value={slug}
										/>
									</div>
									{slugError ? (
										<FieldError>{slugError}</FieldError>
									) : (
										<FieldDescription>
											Your org's URL: /{slug || "…"}
										</FieldDescription>
									)}
								</Field>
							</div>
						</CardContent>
						<CardFooter>
							{serverError ? (
								<CardMeta role="alert">
									<span className="tone-danger">{serverError}</span>
								</CardMeta>
							) : null}
							<Button
								disabled={slugError !== null}
								pending={create.isPending}
								pendingLabel="Creating"
								size="small"
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
