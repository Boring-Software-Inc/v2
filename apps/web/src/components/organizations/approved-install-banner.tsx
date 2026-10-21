import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	Alert,
	AlertAction,
	AlertDescription,
	AlertTitle,
} from "#/components/glaze/ui/alert";
import { Button } from "#/components/glaze/ui/button";
import { approvedInstallRequestsQueryOptions } from "#/lib/onboarding.query";

export function ApprovedInstallBanner() {
	const { data: approved } = useQuery(approvedInstallRequestsQueryOptions());

	if (!approved?.length) {
		return null;
	}
	return (
		<div className="flex flex-col gap-2">
			{approved.map((request) => (
				<Alert key={request.installationId} status="ok">
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
							nativeButton={false}
							render={
								<Link
									search={{
										installation_id: request.installationId,
										setup_action: undefined,
										state: undefined,
									}}
									to="/onboarding/setup"
								/>
							}
							size="sm"
						>
							Connect repos
						</Button>
					</AlertAction>
				</Alert>
			))}
		</div>
	);
}
