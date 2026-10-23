import { ORG_REGION_LABELS, type OrgRegion } from "@tripwire/contracts";

declare module "@tanstack/react-router" {
	interface StaticDataRouteOption {
		region?: OrgRegion;
	}
}

export function noAccessLine(region: OrgRegion): string {
	return `Your role has no access to ${ORG_REGION_LABELS[region].toLowerCase()}.`;
}
