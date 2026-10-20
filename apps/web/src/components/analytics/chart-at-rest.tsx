import type { ComponentProps, ReactNode } from "react";
import { Chart } from "#/components/glaze/ui/chart";
import { MascotArt } from "#/components/mascot/mascot-art";

type CartesianChartProps = Extract<
	ComponentProps<typeof Chart>,
	{ type: "line" | "bar" }
>;

export type ChartAtRestProps = Omit<
	CartesianChartProps,
	"description" | "actions" | "valueFormat" | "legend" | "empty"
> & {
	message: ReactNode;
	action?: ReactNode;
};

function restTick(value: number) {
	return Number.isInteger(value) ? String(value) : "";
}

export function hourlyZeroRows(xKey: string, keys: string[], length = 24) {
	return Array.from({ length }, (_, i) => {
		const ago = length - 1 - i;
		const row: Record<string, string | number> = {
			[xKey]: ago === 0 ? "Now" : `${ago}h ago`,
		};
		for (const key of keys) {
			row[key] = 0;
		}
		return row;
	});
}

export function ChartAtRest({ message, action, ...props }: ChartAtRestProps) {
	return (
		<div className="relative" data-chart-rest="">
			<Chart
				{...props}
				actions={action}
				description={message}
				legend={false}
				valueFormat={restTick}
			/>
			<MascotArt
				className="absolute end-6 bottom-12"
				mood="chart-at-rest"
				size="compact"
			/>
		</div>
	);
}
