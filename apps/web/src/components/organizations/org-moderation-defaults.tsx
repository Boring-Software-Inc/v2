import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ModerationOutcome, ModerationSubject } from "@tripwire/contracts";
import { ActionRow } from "@tripwire/ui/layouts";
import {
	ModerationOutcomeHelp,
	ModerationOutcomePicker,
} from "#/components/settings/moderation-outcome-picker";
import { SettingsSection } from "#/components/settings/settings-frame";
import { Button } from "#/design-system/ui/button";
import { Card, CardContent } from "#/design-system/ui/card";
import { FieldGroup } from "#/design-system/ui/field";
import { Skeleton } from "#/design-system/ui/skeleton";
import { toast } from "#/design-system/ui/toast";
import { Body, SupportingText } from "#/design-system/ui/typography";
import { saveOrgModerationPolicy } from "#/lib/moderation-policy.functions";
import { moderationPolicyQueryOptions } from "#/lib/moderation-policy.query";

export function OrgModerationDefaults({
	org,
	canManage,
}: {
	org: string;
	canManage: boolean;
}) {
	const options = moderationPolicyQueryOptions(org);
	const query = useQuery(options);
	const client = useQueryClient();
	const save = useMutation({
		mutationFn: ({
			subject,
			outcome,
		}: {
			subject: ModerationSubject;
			outcome: ModerationOutcome;
		}) => saveOrgModerationPolicy({ data: { org, subject, outcome } }),
		onSuccess: async (policy) => {
			client.setQueryData(options.queryKey, policy);
			await client.invalidateQueries({ queryKey: options.queryKey });
		},
		onError: () => toast.fail("Couldn’t save the default outcome. Try again."),
	});
	const defaults = query.data?.defaults;
	function setOutcome(
		subject: ModerationSubject,
		outcome: ModerationOutcome | "inherit" | null,
	) {
		if (outcome && outcome !== "inherit") save.mutate({ subject, outcome });
	}

	return (
		<SettingsSection id="moderation-defaults" title="Rule outcomes">
			<Card>
				<CardContent>
					<SupportingText>
						Default outcomes for standalone rules on GitHub. Repositories and
						individual rules can override them.
					</SupportingText>
					{defaults ? (
						<>
							<FieldGroup className="sm:grid sm:grid-cols-2">
								<ModerationOutcomePicker
									disabled={!canManage || save.isPending}
									label="Pull requests"
									onChange={(outcome) => setOutcome("change-request", outcome)}
									value={defaults["change-request"]}
								/>
								<ModerationOutcomePicker
									disabled={!canManage || save.isPending}
									label="Issues"
									onChange={(outcome) => setOutcome("issue", outcome)}
									value={defaults.issue}
								/>
							</FieldGroup>
							<ModerationOutcomeHelp />
						</>
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
							className="h-12 w-full"
						/>
					)}
				</CardContent>
			</Card>
		</SettingsSection>
	);
}
