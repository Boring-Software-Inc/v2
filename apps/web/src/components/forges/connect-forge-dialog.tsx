import { ConnectForgeGrid } from "#/components/forges/connect-forge-grid";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "#/components/glaze/ui/dialog";

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
			<DialogContent size="sm">
				<DialogHeader>
					<DialogTitle>Connect repos</DialogTitle>
					<DialogDescription>
						Pick the forge your repos live on.
					</DialogDescription>
				</DialogHeader>
				<DialogBody>
					<ConnectForgeGrid onDone={() => onOpenChange(false)} org={org} />
				</DialogBody>
			</DialogContent>
		</Dialog>
	);
}
