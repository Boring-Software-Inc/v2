import { useQuery } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AgentClientLogo } from "#/components/agents/agent-client-logo";
import { CodeBoxes, CodeInput } from "#/components/agents/agent-code-boxes";
import { AgentRequestCard } from "#/components/agents/agent-request-card";
import {
	AgentRequestHeader,
	AgentRequestShell,
} from "#/components/agents/agent-request-shell";
import { AgentRequestSkeleton } from "#/components/agents/agent-request-skeleton";
import {
	emptyCells,
	formatCode,
	isComplete,
} from "#/components/agents/device-code";
import { Icon, Success } from "#/components/glaze/icon";
import { Button } from "#/components/glaze/ui/button";
import { Card, CardContent } from "#/components/glaze/ui/card";
import { toast } from "#/components/glaze/ui/toast";
import { answerDevice } from "#/lib/agent-auth-endpoints";
import type { AgentRequestOrg } from "#/lib/agents.functions";
import { grantDeviceOrgs } from "#/lib/agents.functions";
import { deviceRequestQueryOptions } from "#/lib/agents.query";

const route = getRouteApi("/device");

const TITLE = "Sign in the Tripwire CLI";

export function AgentDevicePage() {
	const { user_code: userCode } = route.useSearch();
	if (!userCode) {
		return <EnterCode />;
	}
	return <DeviceRequest userCode={userCode} />;
}

function EnterCode() {
	const navigate = useNavigate();
	const [cells, setCells] = useState(emptyCells);
	const complete = isComplete(cells);
	return (
		<AgentRequestShell>
			<AgentRequestHeader
				subtitle="Enter the code from your terminal."
				title={TITLE}
			/>
			<Card className="w-full">
				<CardContent>
					<form
						className="flex flex-col gap-3"
						onSubmit={(event) => {
							event.preventDefault();
							if (!complete) {
								return;
							}
							void navigate({
								to: "/device",
								search: { user_code: formatCode(cells.join("")) },
							});
						}}
					>
						<CodeInput cells={cells} onChange={setCells} />
						<Button disabled={!complete} type="submit">
							Continue
						</Button>
					</form>
				</CardContent>
			</Card>
		</AgentRequestShell>
	);
}

function orgPhrase(orgs: AgentRequestOrg[]): string {
	const [first, second] = orgs;
	if (orgs.length === 1 && first) {
		return first.name;
	}
	if (orgs.length === 2 && first && second) {
		return `${first.name} and ${second.name}`;
	}
	return `${orgs.length} orgs`;
}

function SignedIn({
	clientName,
	orgs,
}: {
	clientName: string;
	orgs: AgentRequestOrg[];
}) {
	return (
		<AgentRequestShell>
			<AgentRequestHeader
				subtitle="Go back to your terminal. You can close this tab."
				title="You're signed in"
			/>
			<Card className="w-full">
				<CardContent>
					<div className="flex items-center gap-3 px-1 pt-1.5 pb-1">
						<AgentClientLogo className="size-9" clientName={clientName} />
						<div className="flex min-w-0 flex-1 flex-col gap-0.5">
							<span className="truncate type-label-lg text-text-1">
								{clientName}
							</span>
							<span className="truncate type-caption text-text-2">
								Signed in to {orgPhrase(orgs)} for 30 days
							</span>
						</div>
						<Icon className="text-ok" icon={Success} size={20} weight="fill" />
					</div>
				</CardContent>
			</Card>
		</AgentRequestShell>
	);
}

type Outcome =
	| { kind: "allowed"; orgs: AgentRequestOrg[] }
	| { kind: "denied" };

function DeviceRequest({ userCode }: { userCode: string }) {
	const { data, isError } = useQuery(deviceRequestQueryOptions(userCode));
	const [outcome, setOutcome] = useState<Outcome | null>(null);

	if (outcome?.kind === "allowed" && data?.status === "ready") {
		return <SignedIn clientName={data.clientName} orgs={outcome.orgs} />;
	}
	if (outcome?.kind === "denied") {
		return (
			<AgentRequestShell>
				<AgentRequestHeader title="Sign-in denied" />
			</AgentRequestShell>
		);
	}
	if (isError || data?.status === "invalid") {
		return (
			<AgentRequestShell>
				<AgentRequestHeader title="This code expired. Run the sign-in command again." />
			</AgentRequestShell>
		);
	}
	if (!data) {
		return <AgentRequestSkeleton />;
	}
	return (
		<AgentRequestCard
			lead={<CodeBoxes code={userCode} />}
			onDecide={async (accept, orgIds) => {
				try {
					if (accept) {
						await grantDeviceOrgs({ data: { userCode, orgIds } });
					}
					await answerDevice(userCode, accept);
					setOutcome(
						accept
							? {
									kind: "allowed",
									orgs: data.orgs.filter((org) => orgIds.includes(org.id)),
								}
							: { kind: "denied" },
					);
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
			subtitle="Check that this code matches your terminal."
			title={TITLE}
		/>
	);
}
