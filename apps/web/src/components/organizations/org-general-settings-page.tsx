import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { orgSlugSchema } from "@tripwire/contracts";
import { useState } from "react";
import { OrgAvatar } from "#/components/organizations/org-avatar";
import { Button } from "#/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import { Skeleton } from "#/components/ui/skeleton";
import { toast } from "#/components/ui/toast";
import { authQueryKeys } from "#/lib/auth.query";
import type { OrgWithRole } from "#/lib/org.functions";
import { deleteOrg, updateOrg } from "#/lib/org.functions";
import {
	orgCascadeQueryOptions,
	orgContextQueryOptions,
	orgQueryKeys,
} from "#/lib/org.query";

export function OrgGeneralSettingsPage({ org }: { org: string }) {
	const { data: orgContext } = useQuery(orgContextQueryOptions(org));

	if (!orgContext) {
		return <OrgGeneralSettingsPageSkeleton />;
	}

	const isAdmin = orgContext.role === "admin";

	return (
		<div className="flex flex-col gap-6">
			{isAdmin ? (
				<RenameCard key={orgContext.id} org={org} orgContext={orgContext} />
			) : (
				<Card>
					<CardHeader>
						<CardTitle>general</CardTitle>
						<CardDescription>only admins can rename this org.</CardDescription>
					</CardHeader>
					<CardContent className="flex flex-col items-start gap-2">
						<OrgAvatar
							hue={orgContext.avatarHue}
							name={orgContext.name}
							size={40}
						/>
						<div>
							<p className="font-medium text-sm">{orgContext.name}</p>
							<p className="text-muted-foreground text-xs">
								/{orgContext.slug}
							</p>
						</div>
					</CardContent>
				</Card>
			)}

			{isAdmin ? <DangerZone org={org} orgContext={orgContext} /> : null}
		</div>
	);
}

function RenameCard({
	org,
	orgContext,
}: {
	org: string;
	orgContext: OrgWithRole;
}) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [name, setName] = useState(orgContext.name);
	const [slug, setSlug] = useState(orgContext.slug);

	const slugResult = orgSlugSchema.safeParse(slug);
	const slugError =
		slug === orgContext.slug || slugResult.success
			? null
			: (slugResult.error?.issues[0]?.message ?? "invalid slug");

	const dirty = name !== orgContext.name || slug !== orgContext.slug;

	const saveMutation = useMutation({
		mutationFn: () =>
			updateOrg({
				data: {
					org,
					...(name !== orgContext.name ? { name } : {}),
					...(slug !== orgContext.slug ? { slug } : {}),
				},
			}),
		onSuccess: (result) => {
			if ("error" in result) {
				toast(result.error);
				return;
			}
			toast("org saved");
			if (result.slug !== org) {
				navigate({
					to: "/$org/home",
					params: { org: result.slug },
					search: { settings: "settings" },
				});
			}
		},
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: orgQueryKeys.detail(org) });
			queryClient.invalidateQueries({ queryKey: orgQueryKeys.mine() });
		},
	});

	return (
		<Card>
			<CardHeader>
				<CardTitle>general</CardTitle>
				<CardDescription>
					the avatar is derived from the name — watch it shift as you type.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form
					className="flex flex-col gap-4"
					onSubmit={(e) => {
						e.preventDefault();
						if (dirty && !slugError && name.trim().length > 0) {
							saveMutation.mutate();
						}
					}}
				>
					<div className="flex items-end gap-4">
						<OrgAvatar
							animate
							hue={name === orgContext.name ? orgContext.avatarHue : undefined}
							name={name}
							size={48}
						/>
						<label
							className="flex flex-1 flex-col gap-1 text-muted-foreground text-xs"
							htmlFor="org-name"
						>
							name
							<Input
								id="org-name"
								onChange={(e) => setName(e.target.value)}
								placeholder="org name"
								value={name}
							/>
						</label>
					</div>
					<label
						className="flex flex-col gap-1 text-muted-foreground text-xs"
						htmlFor="org-slug"
					>
						slug
						<Input
							aria-invalid={slugError !== null}
							id="org-slug"
							onChange={(e) => setSlug(e.target.value)}
							placeholder="org-slug"
							value={slug}
						/>
						{slugError ? (
							<span className="text-destructive">{slugError}</span>
						) : (
							<span>lowercase letters, numbers, hyphens — 3 to 32 chars.</span>
						)}
					</label>
					<div>
						<Button
							disabled={
								!dirty ||
								slugError !== null ||
								name.trim().length === 0 ||
								saveMutation.isPending
							}
							size="sm"
							type="submit"
						>
							save changes
						</Button>
					</div>
				</form>
			</CardContent>
		</Card>
	);
}

function DangerZone({
	org,
	orgContext,
}: {
	org: string;
	orgContext: OrgWithRole;
}) {
	if (orgContext.isPersonal) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>danger zone</CardTitle>
					<CardDescription>personal orgs can't be deleted.</CardDescription>
				</CardHeader>
			</Card>
		);
	}
	return <DeleteOrgCard org={org} orgName={orgContext.name} />;
}

function DeleteOrgCard({ org, orgName }: { org: string; orgName: string }) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const [confirmName, setConfirmName] = useState("");

	const { data: cascade } = useQuery({
		...orgCascadeQueryOptions(org),
		enabled: open,
	});

	const deleteMutation = useMutation({
		mutationFn: () => deleteOrg({ data: { org, confirmName } }),
		onSuccess: async (result) => {
			if (!result.ok) {
				toast(result.error ?? "could not delete the org");
				return;
			}
			// Pick the destination BEFORE touching the cache, from the org list we
			// already hold, minus the one just deleted.
			const remaining = (
				queryClient.getQueryData<OrgWithRole[]>(orgQueryKeys.mine()) ?? []
			).filter((entry) => entry.slug !== org);
			// Personal first: it always exists and can never be deleted, so it is the
			// one destination guaranteed to resolve no matter how many orgs remain.
			// Server order is already personal-first, so the fallback agrees.
			const next = remaining.find((entry) => entry.isPersonal) ?? remaining[0];

			// Drop the dead org's cache and re-read the session BEFORE navigating.
			// `/` redirects on `session.defaultOrgSlug`, which is served from cache
			// and still names the deleted org — landing there threw `notFound()` on
			// `/$org` and tripped the error boundary instead of going home.
			queryClient.removeQueries({ queryKey: orgQueryKeys.detail(org) });
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: orgQueryKeys.mine() }),
				queryClient.invalidateQueries({ queryKey: authQueryKeys.session() }),
			]);

			toast.success(`deleted ${org}`);
			// Straight to a known-good org rather than via `/`, and without the
			// `?settings=` param that would reopen this dialog on the new org.
			if (next) {
				navigate({ to: "/$org/home", params: { org: next.slug } });
				return;
			}
			navigate({ to: "/" });
		},
	});

	return (
		<Card className="border-destructive/40">
			<CardHeader>
				<CardTitle>danger zone</CardTitle>
				<CardDescription>
					deleting this org is permanent — this is real deletion, not a hide.
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				{open ? (
					<>
						{cascade ? (
							<p className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
								this deletes {cascade.members} members, {cascade.inviteLinks}{" "}
								invite links, {cascade.installations} installations,{" "}
								{cascade.repos} repos (soft-removed), {cascade.ruleConfigs} rule
								configs, {cascade.workflows} workflows — event history is
								retained.
							</p>
						) : (
							<Skeleton className="h-12 rounded-lg" />
						)}
						<label
							className="flex flex-col gap-1 text-muted-foreground text-xs"
							htmlFor="org-delete-confirm"
						>
							type <span className="font-mono text-foreground">{orgName}</span>{" "}
							to confirm
							<Input
								id="org-delete-confirm"
								onChange={(e) => setConfirmName(e.target.value)}
								placeholder={orgName}
								value={confirmName}
							/>
						</label>
						<div className="flex items-center gap-2">
							<Button
								disabled={confirmName !== orgName || deleteMutation.isPending}
								onClick={() => deleteMutation.mutate()}
								size="sm"
								variant="destructive"
							>
								delete this org
							</Button>
							<Button
								onClick={() => {
									setOpen(false);
									setConfirmName("");
								}}
								size="sm"
								variant="ghost"
							>
								cancel
							</Button>
						</div>
					</>
				) : (
					<div>
						<Button
							onClick={() => setOpen(true)}
							size="sm"
							variant="destructive"
						>
							delete org
						</Button>
					</div>
				)}
			</CardContent>
		</Card>
	);
}

export function OrgGeneralSettingsPageSkeleton() {
	return (
		<div className="flex flex-col gap-6">
			<Skeleton className="h-64 rounded-xl" />
			<Skeleton className="h-32 rounded-xl" />
		</div>
	);
}
