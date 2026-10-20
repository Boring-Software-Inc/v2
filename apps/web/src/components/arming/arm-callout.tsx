import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Alert,
	AlertAction,
	AlertDescription,
	AlertTitle,
} from "#/components/glaze/ui/alert";
import { Button } from "#/components/glaze/ui/button";
import {
	Card,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "#/components/glaze/ui/card";
import { toast } from "#/components/glaze/ui/toast";
import { armRepo } from "#/lib/arm.functions";
import { orgContextQueryOptions } from "#/lib/org.query";

interface ArmCalloutProps {
	org: string;
	repo: string;
	repoFullName: string;
	variant?: "hero" | "banner";
	className?: string;
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
				toast.success(`Tripwire is on for ${repoFullName}`);
				return;
			}
			toast.fail(
				`Tripwire did not turn on for ${repoFullName}. Reload the page and try again.`,
			);
		},
		onError: () =>
			toast.fail(
				`Tripwire did not turn on for ${repoFullName}. Check your connection and try again.`,
			),
	});
}

export function ArmCallout({
	org,
	repo,
	repoFullName,
	variant = "banner",
	className,
}: ArmCalloutProps) {
	const arm = useArm(org, repo, repoFullName);
	const { data: orgContext } = useQuery(orgContextQueryOptions(org));
	const canArm = orgContext?.role === "admin";

	if (variant === "hero") {
		return (
			<Card className={className}>
				<CardHeader>
					<CardTitle className="type-heading">
						Tripwire is off for <span className="mono">{repoFullName}</span>
					</CardTitle>
					<CardDescription>
						While it is off, Tripwire ignores every change request here. It
						posts no checks or comments and blocks nothing. Turn it on to check
						each change request against your rules and block the ones that break
						them.
						{orgContext && !canArm ? " An org admin can turn it on." : null}
					</CardDescription>
				</CardHeader>
				{canArm ? (
					<CardFooter>
						<Button
							onClick={() => arm.mutate()}
							pending={arm.isPending}
							pendingLabel="Turning on"
							size="sm"
						>
							Turn on Tripwire
						</Button>
					</CardFooter>
				) : null}
			</Card>
		);
	}

	return (
		<Alert announce={false} className={className} status="warn">
			<AlertTitle>Tripwire is off</AlertTitle>
			<AlertDescription>
				{canArm || !orgContext
					? "Tripwire ignores every change request here until you turn it on."
					: "Tripwire ignores every change request here until an org admin turns it on."}
			</AlertDescription>
			{canArm ? (
				<AlertAction>
					<Button
						onClick={() => arm.mutate()}
						pending={arm.isPending}
						pendingLabel="Turning on"
						size="sm"
						variant="secondary"
					>
						Turn on Tripwire
					</Button>
				</AlertAction>
			) : null}
		</Alert>
	);
}
