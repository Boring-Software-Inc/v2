import { useQuery } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AgentRequestCard } from "#/components/agents/agent-request-card";
import {
	AgentRequestHeader,
	AgentRequestShell,
} from "#/components/agents/agent-request-shell";
import { AgentRequestSkeleton } from "#/components/agents/agent-request-skeleton";
import { Button } from "#/components/glaze/ui/button";
import { Card, CardContent } from "#/components/glaze/ui/card";
import { Field, FieldLabel } from "#/components/glaze/ui/field";
import { Input } from "#/components/glaze/ui/input";
import { toast } from "#/components/glaze/ui/toast";
import { answerDevice } from "#/lib/agent-auth-endpoints";
import { grantDeviceOrgs } from "#/lib/agents.functions";
import { deviceRequestQueryOptions } from "#/lib/agents.query";

const route = getRouteApi("/device");

export function AgentDevicePage() {
	const { user_code: userCode } = route.useSearch();
	if (!userCode) {
		return <EnterCode />;
	}
	return <DeviceRequest userCode={userCode} />;
}

function EnterCode() {
	const navigate = useNavigate();
	const [code, setCode] = useState("");
	return (
		<AgentRequestShell>
			<AgentRequestHeader title="Enter the code from your terminal" />
			<Card>
				<CardContent>
					<form
						className="flex flex-col gap-4"
						onSubmit={(event) => {
							event.preventDefault();
							void navigate({
								to: "/device",
								search: { user_code: code.trim().toUpperCase() },
							});
						}}
					>
						<Field>
							<FieldLabel>Code</FieldLabel>
							<Input
								autoComplete="one-time-code"
								onChange={(event) => setCode(event.target.value)}
								value={code}
							/>
						</Field>
						<div className="flex justify-end">
							<Button disabled={code.trim().length === 0} type="submit">
								Continue
							</Button>
						</div>
					</form>
				</CardContent>
			</Card>
		</AgentRequestShell>
	);
}

function DeviceRequest({ userCode }: { userCode: string }) {
	const { data, isError } = useQuery(deviceRequestQueryOptions(userCode));
	const [outcome, setOutcome] = useState<"allowed" | "denied" | null>(null);

	if (outcome) {
		return (
			<AgentRequestShell>
				<AgentRequestHeader
					title={
						outcome === "allowed"
							? "Signed in. Go back to your terminal."
							: "Sign-in denied"
					}
				/>
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
			clientName={data.clientName}
			extra={
				<p className="type-body">
					Code <span className="font-mono">{userCode}</span>
				</p>
			}
			onDecide={async (accept, orgIds) => {
				try {
					if (accept) {
						await grantDeviceOrgs({ data: { userCode, orgIds } });
					}
					await answerDevice(userCode, accept);
					setOutcome(accept ? "allowed" : "denied");
				} catch (error) {
					toast.fail(
						error instanceof Error
							? error.message
							: "Tripwire could not save your answer. Try again.",
					);
				}
			}}
			orgs={data.orgs}
			redirectHost={null}
			scopes={data.scopes}
		/>
	);
}
