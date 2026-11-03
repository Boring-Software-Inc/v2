import { type ReactNode, useState } from "react";
import {
	AgentRequestHeader,
	AgentRequestShell,
} from "#/components/agents/agent-request-shell";
import {
	permissionsFor,
	staysSignedIn,
} from "#/components/agents/agent-scopes";
import { OrgAvatar } from "#/components/organizations/org-avatar";
import { Icon } from "#/design-system/icon";
import { Button } from "#/design-system/ui/button";
import { Card, CardContent } from "#/design-system/ui/card";
import { Checkbox } from "#/design-system/ui/checkbox";
import type { AgentRequestOrg } from "#/lib/agents.functions";

export function initialOrgPick(
	orgs: AgentRequestOrg[],
	activeOrgId: string | null,
): string[] {
	const active = orgs.find((org) => org.id === activeOrgId);
	if (active) {
		return [active.id];
	}
	const [only] = orgs;
	return orgs.length === 1 && only ? [only.id] : [];
}

export function AgentRequestCard({
	title,
	subtitle,
	lead,
	account,
	scopes,
	orgs,
	activeOrgId,
	onDecide,
}: {
	title: string;
	subtitle: string;
	lead: ReactNode;
	account?: ReactNode;
	scopes: string[];
	orgs: AgentRequestOrg[];
	activeOrgId: string | null;
	onDecide: (accept: boolean, orgIds: string[]) => Promise<void>;
}) {
	const [picked, setPicked] = useState<string[]>(() =>
		initialOrgPick(orgs, activeOrgId),
	);
	const [pending, setPending] = useState<"allow" | "deny" | null>(null);
	const permissions = permissionsFor(scopes);

	const decide = async (accept: boolean) => {
		setPending(accept ? "allow" : "deny");
		try {
			await onDecide(accept, picked);
		} finally {
			setPending(null);
		}
	};

	return (
		<AgentRequestShell>
			<AgentRequestHeader subtitle={subtitle} title={title} />
			<Card data-layout-role="agent-request-card">
				<CardContent>
					{lead}
					{permissions.length > 0 ? (
						<div data-layout-role="agent-permissions">
							<h2>It can</h2>
							<ul>
								{permissions.map((permission) => (
									<li
										data-layout-role="agent-permission"
										key={permission.scope}
									>
										<Icon icon={permission.icon} />
										{permission.label}
									</li>
								))}
							</ul>
						</div>
					) : null}
					<fieldset data-layout-role="agent-org-picker">
						<legend>{orgs.length > 1 ? "Orgs" : "Org"}</legend>
						{orgs.map((org) => {
							const checked = picked.includes(org.id);
							return (
								<label
									data-layout-role="agent-org-option"
									htmlFor={`agent-org-${org.id}`}
									key={org.id}
								>
									<OrgAvatar hue={org.avatarHue} name={org.name} />
									<span>{org.name}</span>
									<Checkbox
										checked={checked}
										id={`agent-org-${org.id}`}
										onCheckedChange={(next) =>
											setPicked((prev) =>
												next
													? [...new Set([...prev, org.id])]
													: prev.filter((id) => id !== org.id),
											)
										}
									/>
								</label>
							);
						})}
					</fieldset>
					<div data-layout-role="agent-request-actions">
						<Button
							disabled={pending !== null}
							onClick={() => void decide(false)}
							pending={pending === "deny"}
							type="button"
							variant="secondary"
						>
							Deny
						</Button>
						<Button
							disabled={picked.length === 0 || pending !== null}
							onClick={() => void decide(true)}
							pending={pending === "allow"}
							type="button"
						>
							Allow
						</Button>
					</div>
					{staysSignedIn(scopes) ? (
						<p data-layout-role="agent-request-duration">
							Stays signed in for 30 days.
						</p>
					) : null}
				</CardContent>
			</Card>
			{account}
		</AgentRequestShell>
	);
}
