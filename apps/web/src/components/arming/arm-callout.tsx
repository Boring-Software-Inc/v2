import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Forge } from "@tripwire/contracts";
import {
	Alert,
	AlertAction,
	AlertDescription,
	AlertTitle,
} from "@tripwire/ui/alert";
import { Button } from "@tripwire/ui/button";
import {
	Card,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@tripwire/ui/card";
import { notify } from "@tripwire/ui/toast";
import { GitCafeMirrorNotice } from "#/components/forges/gitcafe-mirror-notice";
import { useOrgPermission } from "#/hooks/use-org-permission";
import { armRepo } from "#/lib/arm.functions";
import { orgContextQueryOptions } from "#/lib/org.query";
import { trackEvent } from "#/lib/track";

interface ArmCalloutProps {
	forge: Forge;
	org: string;
	repo: string;
	repoFullName: string;
	variant?: "hero" | "banner";
}

function useArm(org: string, repo: string, repoFullName: string) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: () => armRepo({ data: { org, repo } }),
		onSettled: async () => {
			await queryClient.invalidateQueries();
		},
		onSuccess: (result) => {
			if (result.armed) {
				trackEvent("repo_activated", {});
				notify.show({ title: `Tripwire is on for ${repoFullName}` }, "success");
				return;
			}
			notify.show(
				{
					title:
						!result.ok && result.reason === "queue-unavailable"
							? "Tripwire did not turn on. Try again in a moment."
							: `Tripwire did not turn on for ${repoFullName}. Reload the page and try again.`,
				},
				"error",
			);
		},
		onError: () =>
			notify.show(
				{
					title: `Tripwire did not turn on for ${repoFullName}. Check your connection and try again.`,
				},
				"error",
			),
	});
}

export function ArmCallout({
	forge,
	org,
	repo,
	repoFullName,
	variant = "banner",
}: ArmCalloutProps) {
	const arm = useArm(org, repo, repoFullName);
	const { data: orgContext } = useQuery(orgContextQueryOptions(org));
	const canArm = useOrgPermission(org, "connections:manage");

	if (variant === "hero") {
		return (
			<Card>
				<CardHeader>
					<CardTitle data-layout-role="arm-callout-title">
						Tripwire is off for <span className="mono">{repoFullName}</span>
					</CardTitle>
					<CardDescription>
						While it is off, Tripwire ignores every change request here. It
						posts no checks or comments and blocks nothing. Turn it on to check
						each change request against your rules and block the ones that break
						them.
						{orgContext && !canArm ? " An org admin can turn it on." : null}
						{forge === "gitcafe" ? <GitCafeMirrorNotice /> : null}
					</CardDescription>
				</CardHeader>
				{canArm ? (
					<CardFooter>
						<Button
							onAction={() => arm.mutate()}
							pending={arm.isPending}
							pendingLabel="Turning on"
							size="small"
						>
							Turn on Tripwire
						</Button>
					</CardFooter>
				) : null}
			</Card>
		);
	}

	return (
		<Alert status="warning">
			<AlertTitle>Tripwire is off</AlertTitle>
			<AlertDescription>
				{canArm || !orgContext
					? "Tripwire ignores every change request here until you turn it on."
					: "Tripwire ignores every change request here until an org admin turns it on."}
				{forge === "gitcafe" ? <GitCafeMirrorNotice /> : null}
			</AlertDescription>
			{canArm ? (
				<AlertAction>
					<Button
						onAction={() => arm.mutate()}
						pending={arm.isPending}
						pendingLabel="Turning on"
						size="small"
						variant="secondary"
					>
						Turn on Tripwire
					</Button>
				</AlertAction>
			) : null}
		</Alert>
	);
}
