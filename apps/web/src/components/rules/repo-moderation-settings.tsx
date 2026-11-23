import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	MODERATION_OUTCOME_LABELS,
	type ModerationSubject,
	type RepoModerationPolicyPatch,
} from "@tripwire/contracts";
import { Button } from "@tripwire/ui/button";
import { Dialog } from "@tripwire/ui/dialog";
import {
	Field,
	FieldDescription,
	FieldLabel,
	FieldSet,
} from "@tripwire/ui/field";
import { ActionRow } from "@tripwire/ui/layouts";
import { Skeleton } from "@tripwire/ui/skeleton";
import { Switch } from "@tripwire/ui/switch";
import { notify } from "@tripwire/ui/toast";
import { Body } from "@tripwire/ui/typography";
import { useState } from "react";
import { ModerationOutcomePicker } from "#/components/settings/moderation-outcome-picker";
import { saveRepoModerationPolicy } from "#/lib/moderation-policy.functions";
import { repoModerationQueryOptions } from "#/lib/moderation-policy.query";

const SUBJECTS = [
	{ id: "change-request", label: "Pull requests" },
	{ id: "issue", label: "Issues" },
] satisfies { id: ModerationSubject; label: string }[];

export function RepoModerationSettings({
	org,
	repo,
	canManage,
}: {
	org: string;
	repo: string;
	canManage: boolean;
}) {
	const [open, setOpen] = useState(false);
	const options = repoModerationQueryOptions(org, repo);
	const query = useQuery({ ...options, enabled: open });
	const client = useQueryClient();
	const save = useMutation({
		mutationFn: (patch: RepoModerationPolicyPatch) =>
			saveRepoModerationPolicy({ data: { org, repo, patch } }),
		onSuccess: () => client.invalidateQueries({ queryKey: options.queryKey }),
		onError: () =>
			notify.show(
				{ title: "Couldn’t save the rule outcomes. Try again." },
				"error",
			),
	});

	const data = query.data;
	const disabled = !canManage || save.isPending;

	return (
		<Dialog
			description="Choose the default action when a rule fails outside a workflow."
			onOpenChange={setOpen}
			open={open}
			showFooter={false}
			title="Rule outcomes"
			trigger={<Button variant="secondary">Rule outcomes</Button>}
		>
			{data ? (
				<FieldSet legend="Repository defaults">
					<div className="sm:grid sm:grid-cols-2">
						{SUBJECTS.map(({ id, label }) => (
							<ModerationOutcomePicker
								defaultLabel={`Org default (${MODERATION_OUTCOME_LABELS[data.orgDefaults[id]]})`}
								disabled={disabled}
								key={id}
								label={label}
								onChange={(outcome) => {
									if (outcome !== "inherit")
										save.mutate({ defaults: { [id]: outcome } });
								}}
								value={data.policy.defaults[id] ?? null}
							/>
						))}
					</div>
					<Field orientation="horizontal">
						<div>
							<FieldLabel>Check new issues</FieldLabel>
							<FieldDescription>
								Run installed rules that support issues.
							</FieldDescription>
						</div>
						<Switch
							ariaLabel="Check new issues"
							checked={data.policy.issueRulesEnabled}
							disabled={!canManage}
							onCheckedChange={(issueRulesEnabled) =>
								save.mutate({ issueRulesEnabled })
							}
							pending={save.isPending}
						/>
					</Field>
				</FieldSet>
			) : query.isError ? (
				<ActionRow
					secondary={<Body>Couldn’t load the rule outcomes.</Body>}
					primary={
						<Button
							onAction={() => void query.refetch()}
							size="small"
							variant="secondary"
						>
							Retry
						</Button>
					}
				/>
			) : (
				<output
					data-skeleton-box=""
					aria-label="Loading rule outcomes"
					className="h-36 w-full"
				>
					<Skeleton fill />
				</output>
			)}
		</Dialog>
	);
}
