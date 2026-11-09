import { useQuery } from "@tanstack/react-query";
import { AgentAccountRow } from "#/components/agents/agent-account-row";
import { AgentClientLogo } from "#/components/agents/agent-client-logo";
import { AgentRequestCard } from "#/components/agents/agent-request-card";
import {
	AgentRequestHeader,
	AgentRequestShell,
} from "#/components/agents/agent-request-shell";
import { AgentRequestSkeleton } from "#/components/agents/agent-request-skeleton";
import { toast } from "#/design-system/ui/toast";
import { answerConsent } from "#/lib/agent-auth-endpoints";
import { grantConsentOrgs } from "#/lib/agents.functions";
import { consentRequestQueryOptions, rawOAuthQuery } from "#/lib/agents.query";
import { currentUserQueryOptions } from "#/lib/auth.query";

export function AgentConsentPage() {
	const { data, isError } = useQuery(consentRequestQueryOptions());
	const { data: user } = useQuery(currentUserQueryOptions());

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
			account={
				user ? (
					<AgentAccountRow
						forgeLogin={user.forgeLogin}
						name={user.name}
						oauthQuery={rawOAuthQuery}
					/>
				) : null
			}
			lead={
				<div data-layout-role="agent-client-summary">
					<AgentClientLogo clientName={data.clientName} />
					<div>
						<span data-layout-role="agent-client-name">{data.clientName}</span>
						{data.redirectHost ? (
							<span data-layout-role="agent-client-detail">
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
			activeOrgId={data.activeOrgId}
			orgs={data.orgs}
			scopes={data.scopes}
			subtitle="Allow only if you started this from your agent."
			title={`${data.clientName} wants to use Tripwire`}
		/>
	);
}
