import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	MODERATION_OUTCOME_LABELS,
	type ModerationSubject,
	type RepoModerationPolicyPatch,
} from "@tripwire/contracts";
import { ActionRow } from "@tripwire/ui/layouts";
import { useId, useState } from "react";
import { ModerationOutcomePicker } from "#/components/settings/moderation-outcome-picker";
import { Button } from "#/design-system/ui/button";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "#/design-system/ui/dialog";
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldGroup,
	FieldLabel,
	FieldSet,
} from "#/design-system/ui/field";
import { Skeleton } from "#/design-system/ui/skeleton";
import { Switch } from "#/design-system/ui/switch";
import { toast } from "#/design-system/ui/toast";
import { Body } from "#/design-system/ui/typography";
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
	const issueRulesId = useId();
	const [open, setOpen] = useState(false);
	const options = repoModerationQueryOptions(org, repo);
	const query = useQuery({ ...options, enabled: open });
	const client = useQueryClient();
	const save = useMutation({
		mutationFn: (patch: RepoModerationPolicyPatch) =>
			saveRepoModerationPolicy({ data: { org, repo, patch } }),
		onSuccess: () => client.invalidateQueries({ queryKey: options.queryKey }),
		onError: () => toast.fail("Couldn’t save the rule outcomes. Try again."),
	});

	const data = query.data;
	const disabled = !canManage || save.isPending;

	return (
		<Dialog onOpenChange={setOpen} open={open}>
			<DialogTrigger render={<Button variant="secondary" />}>
				Rule outcomes
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Rule outcomes</DialogTitle>
					<DialogDescription>
						Choose the default action when a rule fails outside a workflow.
					</DialogDescription>
				</DialogHeader>
				<DialogBody>
					{data ? (
						<FieldSet aria-label="Repository defaults">
							<FieldGroup className="sm:grid sm:grid-cols-2">
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
							</FieldGroup>
							<Field orientation="horizontal">
								<FieldContent>
									<FieldLabel id={issueRulesId}>Check new issues</FieldLabel>
									<FieldDescription id={`${issueRulesId}-description`}>
										Run installed rules that support GitHub issues.
									</FieldDescription>
								</FieldContent>
								<Switch
									aria-describedby={`${issueRulesId}-description`}
									aria-labelledby={issueRulesId}
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
									onClick={() => void query.refetch()}
									size="sm"
									variant="secondary"
								>
									Retry
								</Button>
							}
						/>
					) : (
						<Skeleton
							aria-label="Loading rule outcomes"
							className="h-36 w-full"
						/>
					)}
				</DialogBody>
			</DialogContent>
		</Dialog>
	);
}
