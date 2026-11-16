import { Button } from "@tripwire/ui/button";
import { Add, FitView, Icon, Subtract } from "@tripwire/ui/icon";
import { Panel, useReactFlow } from "@xyflow/react";

export function CanvasZoom() {
	const { zoomIn, zoomOut, fitView } = useReactFlow();
	return (
		<Panel
			aria-label="Zoom"
			className="!m-3 flex flex-col gap-0.5 rounded-overlay border border-line bg-paper p-0.5"
			position="bottom-right"
			role="group"
		>
			<Button
				ariaLabel="Zoom in"
				onAction={() => zoomIn()}
				size="small"
				variant="ghost"
			>
				<Icon icon={Add} />
			</Button>
			<Button
				ariaLabel="Zoom out"
				onAction={() => zoomOut()}
				size="small"
				variant="ghost"
			>
				<Icon icon={Subtract} />
			</Button>
			<Button
				ariaLabel="Fit to view"
				onAction={() => fitView()}
				size="small"
				variant="ghost"
			>
				<Icon icon={FitView} />
			</Button>
		</Panel>
	);
}
