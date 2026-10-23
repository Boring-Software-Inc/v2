import type { OrgRegion } from "@tripwire/contracts";
import type { ReactNode } from "react";
import { Icon, NoAccess } from "#/components/glaze/icon";
import { useOrgPermission } from "#/hooks/use-org-permission";
import { noAccessLine } from "#/lib/region-access";

interface RegionGateProps {
	org: string;
	region: OrgRegion;
	placeholder: ReactNode;
	children: ReactNode;
}

export function RegionGate({
	org,
	region,
	placeholder,
	children,
}: RegionGateProps) {
	const canRead = useOrgPermission(org, `${region}:read`);
	if (canRead) {
		return children;
	}
	return (
		<div className="relative" data-region-locked={region}>
			<div
				aria-hidden
				className="pointer-events-none select-none blur-[3px]"
				inert
			>
				{placeholder}
			</div>
			<p className="absolute inset-0 flex items-center justify-center gap-2 px-4 text-center type-label text-text-1">
				<Icon icon={NoAccess} />
				{noAccessLine(region)}
			</p>
		</div>
	);
}
