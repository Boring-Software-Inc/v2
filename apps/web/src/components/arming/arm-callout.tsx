import { useMutation, useQueryClient } from "@tanstack/react-query";
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
				toast.success(`Tripwire is now watching ${repoFullName}`);
			}
		},
		onError: () => toast.fail("Couldn't arm the repo. Try again."),
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

	if (variant === "hero") {
		return (
			<Card className={className}>
				<CardHeader>
					<CardTitle className="type-heading">
						Tripwire isn't guarding <span className="mono">{repoFullName}</span>
					</CardTitle>
					<CardDescription>
						Unarmed, it ignores every change request here: no checks, no
						comments, no blocks. Arm it to start checking each one against your
						rules and blocking the ones that break them.
					</CardDescription>
				</CardHeader>
				<CardFooter>
					<Button
						onClick={() => arm.mutate()}
						pending={arm.isPending}
						pendingLabel="Arming"
						size="sm"
					>
						Arm this repo
					</Button>
				</CardFooter>
			</Card>
		);
	}

	return (
		<Alert announce={false} className={className} status="warn">
			<AlertTitle>Not armed</AlertTitle>
			<AlertDescription>
				Tripwire ignores every change request here until you arm it.
			</AlertDescription>
			<AlertAction>
				<Button
					onClick={() => arm.mutate()}
					pending={arm.isPending}
					pendingLabel="Arming"
					size="sm"
					variant="secondary"
				>
					Arm repo
				</Button>
			</AlertAction>
		</Alert>
	);
}
