import type { ComponentProps } from "react";

interface ChartPlotRegionProps extends Omit<ComponentProps<"div">, "style"> {
	height: number;
}

export function ChartPlotRegion({ height, ...props }: ChartPlotRegionProps) {
	return <div {...props} data-slot="chart-plot" style={{ height }} />;
}

interface ChartHitRegionProps
	extends Omit<ComponentProps<"fieldset">, "style" | "className"> {
	bounds: { left: number; top: number; width: number; height: number };
}

export function ChartHitRegion({ bounds, ...props }: ChartHitRegionProps) {
	return <fieldset {...props} data-slot="chart-hit-region" style={bounds} />;
}
