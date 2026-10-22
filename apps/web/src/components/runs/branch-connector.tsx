import { useLayoutEffect, useRef, useState } from "react";

const RAIL = 12;
const BEND = 8;
const FORK_Y = 14;

function snap(value: number, origin: number, ratio: number): number {
	return Math.round((origin + value - 0.5) * ratio) / ratio + 0.5 - origin;
}

function branchPath(
	rail: number,
	center: number,
	fork: number,
	merge: number,
	height: number,
): string {
	const step = Math.sign(center - rail) * BEND;
	return [
		`M${rail} 0V${fork - BEND}`,
		`Q${rail} ${fork} ${rail + step} ${fork}`,
		`H${center - step}`,
		`Q${center} ${fork} ${center} ${fork + BEND}`,
		`V${merge - BEND}`,
		`Q${center} ${merge} ${center - step} ${merge}`,
		`H${rail + step}`,
		`Q${rail} ${merge} ${rail} ${merge + BEND}`,
		`V${height}`,
	].join("");
}

function connectorPath(svg: SVGSVGElement, grid: HTMLElement): string {
	const box = svg.getBoundingClientRect();
	if (box.width === 0) {
		return "";
	}
	const ratio = window.devicePixelRatio || 1;
	const rtl = getComputedStyle(svg).direction === "rtl";
	const x = (value: number) => snap(value, box.left, ratio);
	const y = (value: number) => snap(value, box.top, ratio);
	const rail = x(rtl ? box.width - RAIL : RAIL);
	const fork = y(FORK_Y);
	const merge = y(box.height - FORK_Y);
	return Array.from(grid.children, (column) => {
		const rect = column.getBoundingClientRect();
		const center = x(rect.left + rect.width / 2 - box.left);
		return branchPath(rail, center, fork, merge, box.height);
	}).join("");
}

export function BranchConnector({ grid }: { grid: HTMLElement | null }) {
	const svgRef = useRef<SVGSVGElement>(null);
	const [path, setPath] = useState("");
	useLayoutEffect(() => {
		const svg = svgRef.current;
		if (!svg || !grid) {
			return;
		}
		const measure = () => setPath(connectorPath(svg, grid));
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(svg);
		for (const column of grid.children) {
			observer.observe(column);
		}
		return () => observer.disconnect();
	}, [grid]);
	return (
		<svg
			aria-hidden="true"
			className="pointer-events-none absolute inset-0 hidden size-full overflow-visible md:block"
			ref={svgRef}
		>
			{path ? (
				<path
					className="fill-none stroke-line stroke-(length:--line-width)"
					d={path}
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			) : null}
		</svg>
	);
}
