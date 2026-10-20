import { type CSSProperties, useEffect, useRef } from "react";
import type { MascotEngine } from "#/components/mascot/engine";
import { REST_PATH } from "#/components/mascot/engine";
import {
	BUBBLE_TAIL_PATH,
	bubblePath,
	type Expression,
	PROP_RECT,
	SAGE,
	VIEW_BOX,
	ZZ_PATH,
} from "#/components/mascot/geometry";
import { cn } from "#/lib/glaze/utils";

export type MascotFigureProps = {
	engine: MascotEngine;
	size: number;
	sage: boolean;
	resting: Expression;
	className?: string;
};

const SAGE_VAR = { "--mascot-sage": SAGE } as CSSProperties;

export function MascotFigure({
	engine,
	size,
	sage,
	resting,
	className,
}: MascotFigureProps) {
	const body = useRef<SVGPathElement>(null);
	const zz = useRef<SVGGElement>(null);
	const bubble = useRef<SVGGElement>(null);
	const bubbleBody = useRef<SVGPathElement>(null);
	const prop = useRef<SVGRectElement>(null);
	const drip = useRef<SVGEllipseElement>(null);

	useEffect(() => {
		if (
			!body.current ||
			!zz.current ||
			!bubble.current ||
			!bubbleBody.current ||
			!prop.current ||
			!drip.current
		) {
			return;
		}
		return engine.attach({
			body: body.current,
			zz: zz.current,
			bubble: bubble.current,
			bubbleBody: bubbleBody.current,
			prop: prop.current,
			drip: drip.current,
		});
	}, [engine]);

	return (
		<svg
			aria-hidden="true"
			className={cn(
				"block shrink-0 overflow-visible",
				sage ? "text-(--mascot-sage)" : "text-ink",
				className,
			)}
			height={size}
			style={SAGE_VAR}
			viewBox={VIEW_BOX}
			width={size}
		>
			<path
				d={REST_PATH[resting]}
				fill="currentColor"
				fillRule="evenodd"
				ref={body}
			/>
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
			<ellipse
				cx={0}
				cy={0}
				fill="currentColor"
				ref={drip}
				rx={0}
				ry={0}
				visibility="hidden"
			/>
		</svg>
	);
}
