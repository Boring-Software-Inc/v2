import { type ReactNode, useState } from "react";
import {
	AgentRequestHeader,
	AgentRequestShell,
} from "#/components/agents/agent-request-shell";
import {
	permissionsFor,
	staysSignedIn,
} from "#/components/agents/agent-scopes";
import { Icon } from "#/components/glaze/icon";
import { Button } from "#/components/glaze/ui/button";
import { Card, CardContent } from "#/components/glaze/ui/card";
import { Checkbox } from "#/components/glaze/ui/checkbox";
import { OrgAvatar } from "#/components/organizations/org-avatar";
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
			<Card className="w-full">
				<CardContent>
					{lead}
					{permissions.length > 0 ? (
						<div className="flex flex-col px-1 pt-1">
							<h2 className="pb-1.5 type-label-sm text-text-2">It can</h2>
							<ul className="flex flex-col">
								{permissions.map((permission) => (
									<li
										className="flex h-7 items-center gap-2.5 type-body-sm text-text-1"
										key={permission.scope}
									>
										<Icon className="text-text-2" icon={permission.icon} />
										{permission.label}
									</li>
								))}
							</ul>
						</div>
					) : null}
					<fieldset className="flex flex-col gap-1.5 px-1 pt-1">
						<legend className="type-label-sm text-text-2">
							{orgs.length > 1 ? "Orgs" : "Org"}
						</legend>
						{orgs.map((org) => {
							const checked = picked.includes(org.id);
							return (
								<label
									className="flex h-(--row) cursor-pointer items-center gap-2.5 rounded-overlay border border-line bg-hover-row px-2.5"
									htmlFor={`agent-org-${org.id}`}
									key={org.id}
								>
									<OrgAvatar hue={org.avatarHue} name={org.name} />
									<span className="min-w-0 flex-1 truncate type-label text-text-1">
										{org.name}
									</span>
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
					<div className="flex gap-2 pt-1">
						<Button
							className="flex-1"
							disabled={pending !== null}
							onClick={() => void decide(false)}
							pending={pending === "deny"}
							type="button"
							variant="secondary"
						>
							Deny
						</Button>
						<Button
							className="flex-1"
							disabled={picked.length === 0 || pending !== null}
							onClick={() => void decide(true)}
							pending={pending === "allow"}
							type="button"
						>
							Allow
						</Button>
					</div>
					{staysSignedIn(scopes) ? (
						<p className="self-center py-0.5 type-caption text-text-2">
							Stays signed in for 30 days.
						</p>
					) : null}
				</CardContent>
			</Card>
			{account}
		</AgentRequestShell>
	);
}
