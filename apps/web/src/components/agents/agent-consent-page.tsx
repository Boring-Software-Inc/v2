import { useQuery } from "@tanstack/react-query";
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
			clientName={data.clientName}
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
			redirectHost={data.redirectHost}
			scopes={data.scopes}
		/>
	);
}
