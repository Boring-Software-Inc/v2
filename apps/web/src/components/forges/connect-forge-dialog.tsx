import { Dialog } from "@tripwire/ui/dialog";
import { ConnectForgeGrid } from "#/components/forges/connect-forge-grid";

/**
 * The single "connect repos" surface. One entry point, one grid, the forge
 * chosen inside — replacing the pair of forge-specific entries ("add repos"
 * meaning github, "connect gitlab repos" meaning gitlab) that made the same
 * intent look like two unrelated features.
 */
export function ConnectForgeDialog({
	org,
	open,
	onOpenChange,
}: {
	org: string | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	return (
		<Dialog
			description="Pick the forge your repos live on."
			onOpenChange={onOpenChange}
			open={open}
			showFooter={false}
			size="small"
			title="Connect repos"
		>
			<ConnectForgeGrid onDone={() => onOpenChange(false)} org={org} />
		</Dialog>
	);
}
