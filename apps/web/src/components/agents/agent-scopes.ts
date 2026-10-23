import {
	Connection,
	Customize,
	type GlazeIcon,
	Protected,
	Show,
} from "#/components/glaze/icon";

export interface AgentPermission {
	scope: string;
	label: string;
	icon: GlazeIcon;
}

const AGENT_PERMISSIONS: AgentPermission[] = [
	{
		scope: "tripwire:read",
		label: "See repos, rules, workflows and runs",
		icon: Show,
	},
	{
		scope: "tripwire:configure",
		label: "Change rules and workflows",
		icon: Customize,
	},
	{
		scope: "tripwire:moderate",
		label: "Decide what waits for review",
		icon: Protected,
	},
	{
		scope: "tripwire:admin",
		label: "Connect repos and turn the gate on",
		icon: Connection,
	},
];

const STAYS_SIGNED_IN_SCOPE = "offline_access";

export function permissionsFor(scopes: string[]): AgentPermission[] {
	const asked = new Set(scopes);
	return AGENT_PERMISSIONS.filter((permission) => asked.has(permission.scope));
}

export function staysSignedIn(scopes: string[]): boolean {
	return scopes.includes(STAYS_SIGNED_IN_SCOPE);
}
