import { IconButton } from "@tripwire/ui/button";
import { Add, FitView, Icon, Subtract } from "@tripwire/ui/icon";
import { Panel, useReactFlow } from "@xyflow/react";

export function fitViewOptions() {
	return {
		padding: {
			left: "48px",
			right: "48px",
			top: "64px",
			bottom: "48px",
		},
	} as const;
}

export function CanvasZoom() {
	const { zoomIn, zoomOut, fitView } = useReactFlow();
	return (
		<Panel
			aria-label="Zoom"
			data-layout-role="workflow-canvas-zoom"
			position="bottom-right"
			role="group"
		>
			<IconButton
				icon={<Icon icon={Add} />}
				label="Zoom in"
				onAction={() => zoomIn()}
				size="small"
			/>
			<IconButton
				icon={<Icon icon={Subtract} />}
				label="Zoom out"
				onAction={() => zoomOut()}
				size="small"
			/>
			<IconButton
				icon={<Icon icon={FitView} />}
				label="Fit to view"
				onAction={() => fitView(fitViewOptions())}
				size="small"
			/>
		</Panel>
	);
}
