import { Panel, useReactFlow } from "@xyflow/react";
import { Add, FitView, Icon, Subtract } from "#/components/glaze/icon";
import { Button } from "#/components/glaze/ui/button";

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
				aria-label="Zoom in"
				onClick={() => zoomIn()}
				size="icon-sm"
				variant="ghost"
			>
				<Icon icon={Add} />
			</Button>
			<Button
				aria-label="Zoom out"
				onClick={() => zoomOut()}
				size="icon-sm"
				variant="ghost"
			>
				<Icon icon={Subtract} />
			</Button>
			<Button
				aria-label="Fit to view"
				onClick={() => fitView()}
				size="icon-sm"
				variant="ghost"
			>
				<Icon icon={FitView} />
			</Button>
		</Panel>
	);
}
