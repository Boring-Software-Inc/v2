import { useQuery } from "@tanstack/react-query";
import {
	Alert,
	AlertAction,
	AlertDescription,
	AlertTitle,
} from "@tripwire/ui/alert";
import { Button } from "@tripwire/ui/button";
import { approvedInstallRequestsQueryOptions } from "#/lib/onboarding.query";

export function ApprovedInstallBanner() {
	const { data: approved } = useQuery(approvedInstallRequestsQueryOptions());

	if (!approved?.length) {
		return null;
	}
	return (
		<div className="flex flex-col gap-2">
			{approved.map((request) => (
				<Alert key={request.installationId} role="status" status="success">
					<AlertTitle>
						{request.account} approved your install request
					</AlertTitle>
					<AlertDescription>
						{request.repoCount}{" "}
						{request.repoCount === 1 ? "repo is" : "repos are"} ready to
						connect.
					</AlertDescription>
					<AlertAction>
						<Button
							href={`/onboarding/setup?installation_id=${encodeURIComponent(request.installationId)}`}
							size="small"
						>
							Connect repos
						</Button>
					</AlertAction>
				</Alert>
			))}
		</div>
	);
}
