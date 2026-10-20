import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ForgeMark } from "#/components/common/forge-marks";
import { Button } from "#/components/ui/button";
import { approvedInstallRequestsQueryOptions } from "#/lib/onboarding.query";

export function ApprovedInstallBanner() {
	const { data: approved } = useQuery(approvedInstallRequestsQueryOptions());

	if (!approved?.length) {
		return null;
	}
	return (
		<div className="flex flex-col gap-1.5">
			{approved.map((request) => (
				<div
					className="flex items-center gap-3 rounded-xl bg-card px-4 py-3"
					key={request.installationId}
				>
					<ForgeMark
						className="size-4 shrink-0 text-muted-foreground"
						forge="github"
					/>
					<p className="min-w-0 flex-1 text-sm">
						<span className="font-medium">{request.account}</span>{" "}
						<span className="text-muted-foreground">
							approved your install request — {request.repoCount}{" "}
							{request.repoCount === 1 ? "repo" : "repos"} ready to connect.
						</span>
					</p>
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
						connect
					</Button>
				</div>
			))}
		</div>
	);
}
