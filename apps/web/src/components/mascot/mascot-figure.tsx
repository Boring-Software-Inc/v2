import { type CSSProperties, useEffect, useRef } from "react";
import type { MascotEngine } from "#/components/mascot/engine";
import {
	BOLT_PATH,
	BUBBLE_TAIL_PATH,
	bubblePath,
	CLOUD_PATHS,
	PROP_RECT,
	SAGE,
	VIEW_BOX,
	ZZ_PATH,
} from "#/components/mascot/geometry";
import { cn } from "#/lib/glaze/utils";

export type MascotFigureProps = {
	engine: MascotEngine;
	size: number;
	sage?: boolean;
	tone?: "ink" | "muted";
	path: string;
	className?: string;
};

const SAGE_VAR = { "--mascot-sage": SAGE } as CSSProperties;

export function MascotFigure({
	engine,
	size,
	sage = false,
	tone = "ink",
	path,
	className,
}: MascotFigureProps) {
	const root = useRef<SVGGElement>(null);
	const body = useRef<SVGPathElement>(null);
	const zz = useRef<SVGGElement>(null);
	const bubble = useRef<SVGGElement>(null);
	const bubbleBody = useRef<SVGPathElement>(null);
	const prop = useRef<SVGRectElement>(null);
	const drip = useRef<SVGEllipseElement>(null);
	const cloud = useRef<SVGGElement>(null);
	const cloudBody = useRef<SVGPathElement>(null);
	const bolt = useRef<SVGPathElement>(null);

	useEffect(() => {
		if (
			!root.current ||
			!body.current ||
			!zz.current ||
			!bubble.current ||
			!bubbleBody.current ||
			!prop.current ||
			!drip.current ||
			!cloud.current ||
			!cloudBody.current ||
			!bolt.current
		) {
			return;
		}
		return engine.attach({
			root: root.current,
			body: body.current,
			zz: zz.current,
			bubble: bubble.current,
			bubbleBody: bubbleBody.current,
			prop: prop.current,
			drip: drip.current,
			cloud: cloud.current,
			cloudBody: cloudBody.current,
			bolt: bolt.current,
		});
	}, [engine]);

	return (
		<svg
			aria-hidden="true"
			className={cn(
				"block shrink-0 overflow-visible",
				sage ? "text-(--mascot-sage)" : "text-ink",
				tone === "muted" && "opacity-45",
				className,
			)}
			height={size}
			style={SAGE_VAR}
			viewBox={VIEW_BOX}
			width={size}
		>
			<g ref={root}>
				<path d={path} fill="currentColor" fillRule="evenodd" ref={body} />
				<g ref={zz} visibility="hidden">
					<path d={ZZ_PATH} fill="currentColor" />
				</g>
				<g ref={bubble} visibility="hidden">
					<path
						d={bubblePath(3)}
						fill="currentColor"
						fillRule="evenodd"
						ref={bubbleBody}
					/>
					<path d={BUBBLE_TAIL_PATH} fill="currentColor" />
				</g>
				<rect
					fill="currentColor"
					height={PROP_RECT.size}
					ref={prop}
					visibility="hidden"
					width={PROP_RECT.size}
					x={PROP_RECT.x}
					y={PROP_RECT.y}
				/>
				<g ref={cloud} visibility="hidden">
					<path
						d={CLOUD_PATHS[0]}
						fill="currentColor"
						fillRule="evenodd"
						ref={cloudBody}
					/>
					<path
						d={BOLT_PATH}
						fill="currentColor"
						ref={bolt}
						visibility="hidden"
					/>
				</g>
				<ellipse
					cx={0}
					cy={0}
					fill="currentColor"
					ref={drip}
					rx={0}
					ry={0}
					visibility="hidden"
				/>
			</g>
		</svg>
	);
}
