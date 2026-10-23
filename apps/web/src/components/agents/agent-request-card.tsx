import { type ReactNode, useState } from "react";
import {
	AgentRequestHeader,
	AgentRequestShell,
} from "#/components/agents/agent-request-shell";
import { MetaRow } from "#/components/common/meta-row";
import { Button } from "#/components/glaze/ui/button";
import { Card, CardContent } from "#/components/glaze/ui/card";
import { Checkbox } from "#/components/glaze/ui/checkbox";
import {
	Item,
	ItemContent,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "#/components/glaze/ui/item";
import { OrgAvatar } from "#/components/organizations/org-avatar";
import type { AgentRequestOrg } from "#/lib/agents.functions";

const SCOPE_LABELS: Record<string, string> = {
	"tripwire:read": "See repos, rules, workflows and runs",
	"tripwire:configure": "Change rules and workflows",
	"tripwire:moderate": "Decide human review items",
	"tripwire:admin": "Get install links and turn the gate on",
	offline_access: "Stay connected for up to 30 days",
	email: "Your email address",
	profile: "Your name and avatar",
};

export function scopeLines(scopes: string[]): string[] {
	return scopes.flatMap((scope) => {
		const label = SCOPE_LABELS[scope];
		return label ? [label] : [];
	});
}

export function AgentRequestCard({
	clientName,
	redirectHost,
	scopes,
	orgs,
	extra,
	onDecide,
}: {
	clientName: string;
	redirectHost: string | null;
	scopes: string[];
	orgs: AgentRequestOrg[];
	extra?: ReactNode;
	onDecide: (accept: boolean, orgIds: string[]) => Promise<void>;
}) {
	const [picked, setPicked] = useState<string[]>(() =>
		orgs.length === 1 && orgs[0] ? [orgs[0].id] : [],
	);
	const [pending, setPending] = useState<"allow" | "deny" | null>(null);
	const lines = scopeLines(scopes);

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
			<AgentRequestHeader title={`${clientName} wants access to Tripwire`} />
			<Card>
				<CardContent className="flex flex-col gap-4">
					{extra}
					{redirectHost ? (
						<MetaRow>
							<span>Returns to {redirectHost}</span>
						</MetaRow>
					) : null}
					{lines.length > 0 ? (
						<ul aria-label="Access" className="flex flex-col gap-1 type-body">
							{lines.map((line) => (
								<li key={line}>{line}</li>
							))}
						</ul>
					) : null}
					<fieldset className="flex flex-col gap-2">
						<legend className="mb-2 type-label text-text-2">Orgs</legend>
						<ItemGroup variant="plain">
							{orgs.map((org) => {
								const checked = picked.includes(org.id);
								return (
									<Item key={org.id}>
										<ItemMedia>
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
										</ItemMedia>
										<ItemMedia>
											<OrgAvatar hue={org.avatarHue} name={org.name} />
										</ItemMedia>
										<ItemContent>
											<ItemTitle>
												<label htmlFor={`agent-org-${org.id}`}>
													{org.name}
												</label>
											</ItemTitle>
										</ItemContent>
									</Item>
								);
							})}
						</ItemGroup>
					</fieldset>
					<div className="flex flex-wrap justify-end gap-2">
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
				</CardContent>
			</Card>
		</AgentRequestShell>
	);
}
