import { useEffect, useRef } from "react";
import { watchGaze } from "#/components/dither/gaze-store";

const EYES = [
	{ x: 4, y: 8 },
	{ x: 20, y: 8 },
];

export function AvatarEyes() {
	const ref = useRef<SVGSVGElement>(null);

	useEffect(() => {
		const el = ref.current;
		if (!el) {
			return;
		}
		let release: (() => void) | null = null;
		const io = new IntersectionObserver(([entry]) => {
			if (entry?.isIntersecting) {
				release ??= watchGaze(el);
			} else {
				release?.();
				release = null;
			}
		});
		io.observe(el);
		return () => {
			io.disconnect();
			release?.();
		};
	}, []);

	return (
		<svg
			aria-hidden="true"
			className="group/eyes absolute inset-0 size-full"
			data-slot="avatar-eyes"
			ref={ref}
			shapeRendering="crispEdges"
			viewBox="0 0 32 32"
		>
			{EYES.map((eye) => (
				<g data-eye="" key={eye.x}>
					<rect
						className="fill-paper"
						height={8}
						width={8}
						x={eye.x}
						y={eye.y}
					/>
					<rect
						className="fill-ink"
						data-pupil=""
						height={4}
						width={4}
						x={eye.x + 2}
						y={eye.y + 2}
					/>
				</g>
			))}
		</svg>
	);
}
