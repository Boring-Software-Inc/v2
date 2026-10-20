import {
	lazy,
	Suspense,
	useEffect,
	useId,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { prefersReducedMotion } from "#/components/dither/pixel";
import type { ShaderShape } from "#/components/dither/shader-dither-canvas";
import {
	releaseShaderSlot,
	setShaderSlot,
	shaderSlotWinner,
	subscribeShaderSlot,
} from "#/components/dither/shader-slot";
import { cn } from "#/lib/glaze/utils";

const ShaderDitherCanvas = lazy(
	() => import("#/components/dither/shader-dither-canvas"),
);

type ShaderTone = "faint" | "soft";
type ShaderMask = "edges" | "sides" | "bottom" | "top";

const TONE_TOKEN: Record<ShaderTone, string> = {
	faint: "--ink-10",
	soft: "--ink-15",
};

export interface ShaderDitherProps {
	shape?: ShaderShape;
	tone?: ShaderTone;
	mask?: ShaderMask;
	speed?: number;
	scale?: number;
	size?: number;
	priority?: number;
	className?: string;
}

function normalizeColor(value: string): string | null {
	const ctx = document.createElement("canvas").getContext("2d");
	if (!ctx) {
		return null;
	}
	ctx.fillStyle = value;
	return ctx.fillStyle;
}

function resolveColor(probe: HTMLElement, token: string): string | null {
	const raw = getComputedStyle(probe).getPropertyValue(token).trim();
	return raw ? normalizeColor(raw) : null;
}

function useInk(ref: React.RefObject<HTMLElement | null>, token: string) {
	const [ink, setInk] = useState<{ front: string; back: string } | null>(null);
	useEffect(() => {
		const el = ref.current;
		if (!el) {
			return;
		}
		const read = () => {
			const front = resolveColor(el, token);
			const back = normalizeColor("transparent");
			setInk(front && back ? { front, back } : null);
		};
		read();
		const observer = new MutationObserver(read);
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["class", "data-theme"],
		});
		return () => observer.disconnect();
	}, [ref, token]);
	return ink;
}

function useLiveVisibility(ref: React.RefObject<HTMLElement | null>) {
	const [onScreen, setOnScreen] = useState(false);
	const [pageVisible, setPageVisible] = useState(true);
	useEffect(() => {
		const el = ref.current;
		if (!el) {
			return;
		}
		const io = new IntersectionObserver(([entry]) =>
			setOnScreen(entry?.isIntersecting ?? false),
		);
		io.observe(el);
		const onVisibility = () =>
			setPageVisible(document.visibilityState === "visible");
		onVisibility();
		document.addEventListener("visibilitychange", onVisibility);
		return () => {
			io.disconnect();
			document.removeEventListener("visibilitychange", onVisibility);
		};
	}, [ref]);
	return { onScreen, pageVisible };
}

export function ShaderDither({
	shape = "simplex",
	tone = "faint",
	mask = "edges",
	speed = 0.4,
	scale = 0.55,
	size = 2.8,
	priority = 0,
	className,
}: ShaderDitherProps) {
	const id = useId();
	const ref = useRef<HTMLSpanElement>(null);
	const { onScreen, pageVisible } = useLiveVisibility(ref);
	const ink = useInk(ref, TONE_TOKEN[tone]);
	const [seen, setSeen] = useState(false);
	const [still, setStill] = useState(true);

	useEffect(() => {
		setStill(prefersReducedMotion());
	}, []);

	useEffect(() => {
		if (onScreen) {
			setSeen(true);
		}
		setShaderSlot(id, priority, onScreen);
	}, [id, priority, onScreen]);

	useEffect(() => () => releaseShaderSlot(id), [id]);

	const winner = useSyncExternalStore(
		subscribeShaderSlot,
		shaderSlotWinner,
		() => null,
	);
	const live = winner === id && onScreen && pageVisible && !still;

	return (
		<span
			aria-hidden
			className={cn(
				"pointer-events-none absolute inset-0 overflow-hidden",
				className,
			)}
			data-shader-mask={mask}
			ref={ref}
		>
			{seen && ink && winner === id ? (
				<Suspense fallback={null}>
					<ShaderDitherCanvas
						back={ink.back}
						ink={ink.front}
						scale={scale}
						shape={shape}
						size={size}
						speed={live ? speed : 0}
					/>
				</Suspense>
			) : null}
		</span>
	);
}
