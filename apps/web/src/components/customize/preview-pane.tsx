import { type ReactNode, useId, useRef } from "react";
import { ChevronDown, ChevronUp, Icon, Show } from "#/components/glaze/icon";
import { Button } from "#/components/glaze/ui/button";
import { SPRING_STYLE } from "#/components/layouts/inset-sheet";

export type SheetState = "closed" | "half" | "full";

const ORDER: SheetState[] = ["closed", "half", "full"];
const SWIPE_PX = 24;

function stepped(state: SheetState, by: 1 | -1): SheetState {
	const next = ORDER.indexOf(state) + by;
	return ORDER[Math.min(ORDER.length - 1, Math.max(0, next))] ?? state;
}

export function PreviewPane({
	sheet,
	onSheetChange,
	children,
}: {
	sheet: SheetState;
	onSheetChange: (next: SheetState) => void;
	children: ReactNode;
}) {
	const titleId = useId();
	const bodyId = useId();
	const toggleRef = useRef<HTMLButtonElement>(null);
	const swipe = useRef<{ y: number; moved: boolean } | null>(null);

	const close = () => {
		onSheetChange("closed");
		toggleRef.current?.focus();
	};

	return (
		<section
			aria-labelledby={titleId}
			className="absolute inset-x-0 bottom-0 z-(--z-sticky) flex h-15 flex-col overflow-hidden rounded-t-shell bg-shell transition-[height] duration-(--sheet-rise) ease-(--sheet-spring) max-lg:group-data-[sheet=full]/customize:h-[calc(100%-var(--space-4))] max-lg:group-data-[sheet=half]/customize:h-1/2 motion-reduce:transition-none forced-colors:border-t forced-colors:border-[CanvasText] lg:static lg:col-start-2 lg:row-start-2 lg:h-auto lg:rounded-none lg:transition-none"
			onKeyDown={(event) => {
				if (event.key === "Escape" && sheet !== "closed") {
					event.stopPropagation();
					close();
				}
			}}
			style={SPRING_STYLE}
		>
			<div
				className="flex shrink-0 touch-none flex-col lg:hidden"
				onPointerCancel={() => {
					swipe.current = null;
				}}
				onPointerDown={(event) => {
					swipe.current = { y: event.clientY, moved: false };
				}}
				onPointerMove={(event) => {
					const start = swipe.current;
					if (
						start &&
						!event.currentTarget.hasPointerCapture(event.pointerId) &&
						Math.abs(event.clientY - start.y) >= SWIPE_PX / 2
					) {
						event.currentTarget.setPointerCapture(event.pointerId);
					}
				}}
				onPointerUp={(event) => {
					const start = swipe.current;
					if (!start) {
						return;
					}
					const dy = event.clientY - start.y;
					if (Math.abs(dy) >= SWIPE_PX) {
						start.moved = true;
						onSheetChange(stepped(sheet, dy < 0 ? 1 : -1));
					}
				}}
			>
				<span
					aria-hidden
					className="mx-auto mt-2 h-1 w-9 rounded-pill bg-pressed"
				/>
				<div className="flex h-12 items-center gap-1 ps-2 pe-2">
					<Button
						aria-controls={bodyId}
						aria-expanded={sheet !== "closed"}
						className="min-w-0 flex-1 justify-start"
						onClick={() => {
							if (swipe.current?.moved) {
								swipe.current = null;
								return;
							}
							swipe.current = null;
							onSheetChange(sheet === "closed" ? "half" : "closed");
						}}
						ref={toggleRef}
						size="lg"
						variant="ghost"
					>
						<Icon icon={Show} />
						Preview
					</Button>
					{sheet === "full" ? null : (
						<Button
							aria-label="Expand preview"
							onClick={() => onSheetChange(stepped(sheet, 1))}
							size="icon-lg"
							variant="ghost"
						>
							<Icon icon={ChevronUp} />
						</Button>
					)}
					{sheet === "closed" ? null : (
						<Button
							aria-label="Collapse preview"
							onClick={() => onSheetChange(stepped(sheet, -1))}
							size="icon-lg"
							variant="ghost"
						>
							<Icon icon={ChevronDown} />
						</Button>
					)}
				</div>
			</div>
			<h2
				className="flex h-12 shrink-0 items-center px-6 type-label-lg text-text-1 max-lg:sr-only"
				id={titleId}
			>
				Preview
			</h2>
			<div
				className="min-h-0 flex-1 overflow-y-auto group-data-[sheet=closed]/customize:max-lg:invisible"
				id={bodyId}
			>
				<div className="w-full max-w-196 p-4 pb-[calc(var(--space-4)+env(safe-area-inset-bottom))] sm:p-6 lg:p-8">
					{children}
				</div>
			</div>
		</section>
	);
}
