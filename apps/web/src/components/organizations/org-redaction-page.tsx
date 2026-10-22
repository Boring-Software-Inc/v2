import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RedactionPolicy } from "@tripwire/contracts";
import { useState } from "react";
import { Button } from "#/components/glaze/ui/button";
import {
	Skeleton,
	SkeletonSwap,
	SkeletonText,
} from "#/components/glaze/ui/skeleton";
import { toast } from "#/components/glaze/ui/toast";
import { PreviewLinkProvider } from "#/components/responses/preview-link";
import { RedactionControls } from "#/components/responses/redaction-controls";
import { sameSurfaces } from "#/components/responses/redaction-model";
import { SettingSection } from "#/components/responses/setting-rows";
import { useOrgPermission } from "#/hooks/use-org-permission";
import {
	type OrgResponseDefaultsView,
	saveOrgResponseDefaults,
} from "#/lib/response.functions";
import {
	orgResponseDefaultsQueryOptions,
	responseQueryKeys,
} from "#/lib/response.query";

function samePolicy(a: RedactionPolicy, b: RedactionPolicy): boolean {
	return (
		a.level === b.level &&
		a.showHelp === b.showHelp &&
		sameSurfaces(a.surfaces, b.surfaces)
	);
}

function usageLine(view: OrgResponseDefaultsView): string {
	const { inheriting, overriding } = view.usage;
	const inherit = `${inheriting} ${inheriting === 1 ? "repo inherits" : "repos inherit"}`;
	return overriding === 0
		? `${inherit}.`
		: `${inherit}. ${overriding} override.`;
}

export function OrgRedactionPage({ org }: { org: string }) {
	const canEdit = useOrgPermission(org, "orgResponseDefaults:update");
	const { data } = useQuery(orgResponseDefaultsQueryOptions(org));

	return (
		<SkeletonSwap
			fallback={<OrgRedactionPageSkeleton />}
			label="Loading redaction defaults"
			loading={!data}
		>
			{data ? (
				<PreviewLinkProvider>
					<OrgRedactionForm
						canEdit={canEdit}
						key={JSON.stringify(data.defaults.redaction)}
						org={org}
						view={data}
					/>
				</PreviewLinkProvider>
			) : null}
		</SkeletonSwap>
	);
}

function OrgRedactionForm({
	org,
	view,
	canEdit,
}: {
	org: string;
	view: OrgResponseDefaultsView;
	canEdit: boolean;
}) {
	const queryClient = useQueryClient();
	const saved = view.defaults.redaction;
	const [draft, setDraft] = useState<RedactionPolicy>(saved);
	const dirty = !samePolicy(draft, saved);

	const saveMutation = useMutation({
		mutationFn: () =>
			saveOrgResponseDefaults({
				data: { org, defaults: { ...view.defaults, redaction: draft } },
			}),
		onSuccess: (result) => {
			if ("error" in result) {
				toast.fail(result.error);
				return;
			}
			toast.success("Redaction defaults saved");
		},
		onSettled: () =>
			queryClient.invalidateQueries({
				queryKey: responseQueryKeys.all,
			}),
	});

	return (
		<form
			className="flex max-w-140 flex-col gap-4"
			onSubmit={(event) => {
				event.preventDefault();
				if (dirty) {
					saveMutation.mutate();
				}
			}}
		>
			<SettingSection
				description="What people outside your org see."
				id="org-redaction"
				title="Redaction"
			>
				<RedactionControls
					disabled={!canEdit}
					onLevel={(level) => setDraft((prev) => ({ ...prev, level }))}
					onShowHelp={(showHelp) => setDraft((prev) => ({ ...prev, showHelp }))}
					onSurfaces={(surfaces) => setDraft((prev) => ({ ...prev, surfaces }))}
					policy={draft}
				/>
			</SettingSection>
			<div className="flex items-center gap-2 px-3">
				<span className="me-auto type-body-sm text-text-2">
					{usageLine(view)}
				</span>
				{canEdit ? (
					<>
						<Button
							disabled={!dirty || saveMutation.isPending}
							onClick={() => setDraft(saved)}
							size="sm"
							type="button"
							variant="secondary"
						>
							Discard
						</Button>
						<Button
							disabled={!dirty}
							pending={saveMutation.isPending}
							size="sm"
							type="submit"
						>
							Save
						</Button>
					</>
				) : null}
			</div>
		</form>
	);
}

export function OrgRedactionPageSkeleton() {
	return (
		<div className="flex max-w-140 flex-col gap-4 px-3">
			<SkeletonText className="w-24" />
			<Skeleton className="h-10 w-full rounded-pill" />
			<SkeletonText className="w-48" />
		</div>
	);
}
