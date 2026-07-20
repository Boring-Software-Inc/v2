import { useMutation } from "@tanstack/react-query";
import { orgSlugSchema, slugifyOrgName } from "@tripwire/contracts";
import { useId, useState } from "react";
import { OrgAvatar } from "#/components/organizations/org-avatar";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { createOrg } from "#/lib/org.functions";

/**
 * `/` when the caller has no orgs (open-dev edge) — create the first one.
 * §7: the avatar is DERIVED from the name and regenerates live as they type;
 * the slug is auto-suggested but stays editable. On success we hard-navigate
 * so the whole session picks up the new org.
 */
export function NoOrgsPage() {
	const nameId = useId();
	const slugId = useId();
	const [name, setName] = useState("");
	const [slugDraft, setSlugDraft] = useState<string | null>(null);
	const slug = slugDraft ?? slugifyOrgName(name);
	const slugCheck = orgSlugSchema.safeParse(slug);
	const slugError =
		slug.length > 0 && !slugCheck.success
			? (slugCheck.error?.issues[0]?.message ?? "invalid slug")
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

	const canSubmit =
		name.trim().length > 0 && slugCheck.success && !create.isPending;

	return (
		<div className="flex min-h-dvh items-center justify-center bg-background px-6">
			<form
				className="flex w-full max-w-sm flex-col gap-5 rounded-xl bg-card px-6 py-6"
				onSubmit={(event) => {
					event.preventDefault();
					if (canSubmit) {
						create.mutate();
					}
				}}
			>
				<div className="flex items-center gap-3">
					<OrgAvatar animate name={name} size={40} />
					<div className="flex flex-col gap-0.5">
						<h1 className="font-semibold text-lg tracking-tight">
							create your first org
						</h1>
						<p className="text-muted-foreground text-sm">
							everything in tripwire lives inside an org.
						</p>
					</div>
				</div>

				<div className="flex flex-col gap-1.5">
					<label className="font-medium text-sm" htmlFor={nameId}>
						name
					</label>
					<Input
						autoFocus
						id={nameId}
						onChange={(event) => setName(event.target.value)}
						placeholder="acme"
						value={name}
					/>
				</div>

				<div className="flex flex-col gap-1.5">
					<label className="font-medium text-sm" htmlFor={slugId}>
						slug
					</label>
					<Input
						aria-invalid={slugError ? true : undefined}
						id={slugId}
						onChange={(event) => setSlugDraft(event.target.value.toLowerCase())}
						placeholder="acme"
						value={slug}
					/>
					{slugError ? (
						<p className="text-destructive text-xs">{slugError}</p>
					) : (
						<p className="text-muted-foreground text-xs">
							your org's URL: /{slug || "…"}
						</p>
					)}
				</div>

				{serverError ? (
					<p className="text-destructive text-xs">{serverError}</p>
				) : null}

				<Button disabled={!canSubmit} size="sm" type="submit">
					{create.isPending ? "creating…" : "create org"}
				</Button>
			</form>
		</div>
	);
}
