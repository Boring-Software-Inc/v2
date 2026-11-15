import type { ComponentProps } from "react";

export interface PanelProps
	extends Omit<ComponentProps<"div">, "className" | "style" | "color"> {
	padding?: "default" | "none";
}

export function Panel({ padding = "default", ...props }: PanelProps) {
	return (
		<div
			className="ui-panel"
			data-padding={padding}
			data-slot="panel"
			{...props}
		/>
	);
}
