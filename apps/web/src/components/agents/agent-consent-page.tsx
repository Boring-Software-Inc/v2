import { useQuery } from "@tanstack/react-query";
import { AgentClientLogo } from "#/components/agents/agent-client-logo";
import { AgentRequestCard } from "#/components/agents/agent-request-card";
import {
	AgentRequestHeader,
	AgentRequestShell,
} from "#/components/agents/agent-request-shell";
import { AgentRequestSkeleton } from "#/components/agents/agent-request-skeleton";
import { toast } from "#/components/glaze/ui/toast";
import { answerConsent } from "#/lib/agent-auth-endpoints";
import { grantConsentOrgs } from "#/lib/agents.functions";
import { consentRequestQueryOptions, rawOAuthQuery } from "#/lib/agents.query";

export function AgentConsentPage() {
	const { data, isError } = useQuery(consentRequestQueryOptions());

	if (isError || data?.status === "invalid") {
		return (
			<AgentRequestShell>
				<AgentRequestHeader title="This sign-in link expired. Start again from your agent." />
			</AgentRequestShell>
		);
	}
	if (!data) {
		return <AgentRequestSkeleton />;
	}

	return (
		<AgentRequestCard
			lead={
				<div className="flex items-center gap-3 px-1 pt-1.5 pb-0.5">
					<AgentClientLogo clientName={data.clientName} />
					<div className="flex min-w-0 flex-1 flex-col gap-0.5">
						<span className="truncate type-label-lg text-text-1">
							{data.clientName}
						</span>
						{data.redirectHost ? (
							<span className="truncate font-mono text-[12px] text-text-2 leading-4">
								Returns to {data.redirectHost}
							</span>
						) : null}
					</div>
				</div>
			}
			onDecide={async (accept, orgIds) => {
				try {
					const oauthQuery = rawOAuthQuery();
					if (accept) {
						await grantConsentOrgs({ data: { oauthQuery, orgIds } });
					}
					window.location.assign(await answerConsent(oauthQuery, accept));
				} catch (error) {
					toast.fail(
						error instanceof Error
							? error.message
							: "Tripwire could not save your answer. Try again.",
					);
				}
			}}
			orgs={data.orgs}
			scopes={data.scopes}
			subtitle="Allow only if you started this from your agent."
			title={`${data.clientName} wants to use Tripwire`}
		/>
	);
}
