import { ConnectForgeGrid } from "#/components/forges/connect-forge-grid";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";

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
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className="max-w-[334px] p-0">
				<DialogHeader className="px-3 py-2.5">
					<DialogTitle className="font-medium text-xs leading-4">
						connect repos
					</DialogTitle>
					<DialogDescription className="leading-5">
						pick the forge your repos live on.
					</DialogDescription>
				</DialogHeader>
				<div className="p-0.5 pt-0">
					<ConnectForgeGrid onDone={() => onOpenChange(false)} org={org} />
				</div>
			</DialogContent>
		</Dialog>
	);
}
