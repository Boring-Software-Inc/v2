import { Dithering } from "@paper-design/shaders-react";

export type ShaderShape = "simplex" | "warp" | "wave" | "ripple" | "swirl";

export interface ShaderDitherCanvasProps {
	ink: string;
	back: string;
	shape: ShaderShape;
	speed: number;
	scale: number;
	size: number;
}

export default function ShaderDitherCanvas({
	ink,
	back,
	shape,
	speed,
	scale,
	size,
}: ShaderDitherCanvasProps) {
	return (
		<Dithering
			className="absolute inset-0 size-full"
			colorBack={back}
			colorFront={ink}
			frame={4200}
			height="100%"
			maxPixelCount={1920 * 400}
			minPixelRatio={1}
			scale={scale}
			shape={shape}
			size={size}
			speed={speed}
			type="8x8"
			width="100%"
		/>
	);
}
