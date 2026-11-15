import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { DestructiveDialog } from "@tripwire/ui/dialog";
import { notify } from "@tripwire/ui/toast";
import { useState } from "react";
import { OrgAvatar } from "#/components/organizations/org-avatar";
import { authQueryKeys } from "#/lib/auth.query";
import type { OrgWithRole } from "#/lib/org.functions";
import { deleteOrg } from "#/lib/org.functions";
import { orgQueryKeys } from "#/lib/org.query";

export function DeleteOrgDialog({
	org,
	orgContext,
}: {
	org: string;
	orgContext: OrgWithRole;
}) {
	const [open, setOpen] = useState(false);
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const orgName = orgContext.name;
	const deletion = useMutation({
		mutationFn: async () => {
			const result = await deleteOrg({ data: { org, confirmName: orgName } });
			if (!result.ok) {
				throw new Error(
					result.error ?? "Tripwire couldn't delete the org. Try again.",
				);
			}
			return result;
		},
		onSuccess: async () => {
			const remaining = (
				queryClient.getQueryData<OrgWithRole[]>(orgQueryKeys.mine()) ?? []
			).filter((entry) => entry.slug !== org);
			const next = remaining.find((entry) => entry.isPersonal) ?? remaining[0];

			queryClient.removeQueries({ queryKey: orgQueryKeys.detail(org) });
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: orgQueryKeys.mine() }),
				queryClient.invalidateQueries({ queryKey: authQueryKeys.session() }),
			]);

			notify.show({ title: `Deleted ${orgName}` }, "success");
			if (next) {
				navigate({ to: "/$org/home", params: { org: next.slug } });
				return;
			}
			navigate({ to: "/" });
		},
	});

	return (
		<DestructiveDialog
			confirmLabel="Delete org"
			confirmText={orgName}
			description="This can't be undone."
			media={
				<OrgAvatar
					animate
					hue={orgContext.avatarHue}
					name={orgName}
					replayToken={open ? 1 : 0}
					size="xl"
				/>
			}
			onConfirm={() => deletion.mutateAsync()}
			onOpenChange={setOpen}
			open={open}
			pendingLabel="Deleting"
			title={`Delete ${orgName}?`}
			trigger={{ label: "Delete organization", size: "small" }}
		/>
	);
}
