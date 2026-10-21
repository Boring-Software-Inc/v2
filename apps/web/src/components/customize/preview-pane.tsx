import { type ReactNode, useId } from "react";
import { Icon, Show } from "#/components/glaze/icon";
import { Button } from "#/components/glaze/ui/button";
import {
	Drawer,
	DrawerContent,
	DrawerTitle,
} from "#/components/glaze/ui/drawer";
import { useMediaQuery } from "#/hooks/use-media-query";

export type SheetState = "closed" | "half" | "full";

const PEEK = "68px";

const SNAP = {
	closed: PEEK,
	half: 0.5,
	full: 0.92,
} satisfies Record<SheetState, string | number>;

function sheetFor(snap: string | number | null): SheetState {
	if (snap === SNAP.full) {
		return "full";
	}
	return snap === SNAP.half ? "half" : "closed";
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
	const narrow = useMediaQuery("(max-width: 1023.98px)");

	if (narrow) {
		return (
			<Drawer
				modal={false}
				onOpenChange={(open) => {
					if (!open) {
						onSheetChange("closed");
					}
				}}
				onSnapPointChange={(snap) => onSheetChange(sheetFor(snap))}
				open
				showSwipeHandle
				snapPoints={[SNAP.closed, SNAP.half, SNAP.full]}
				snapPoint={SNAP[sheet]}
			>
				<DrawerContent>
					<DrawerTitle className="sr-only">Preview</DrawerTitle>
					<div className="flex shrink-0 px-2 pb-1">
						<Button
							aria-expanded={sheet !== "closed"}
							className="min-w-0 flex-1 justify-start"
							onClick={() =>
								onSheetChange(sheet === "closed" ? "half" : "closed")
							}
							size="lg"
							variant="ghost"
						>
							<Icon icon={Show} />
							Preview
						</Button>
					</div>
					<div
						className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
						inert={sheet === "closed" ? true : undefined}
					>
						<div className="w-full p-4 pb-[calc(var(--space-4)+env(safe-area-inset-bottom))] sm:p-6">
							{children}
						</div>
					</div>
				</DrawerContent>
			</Drawer>
		);
	}

	return (
		<section
			aria-labelledby={titleId}
			className="flex min-h-0 flex-col overflow-hidden bg-shell max-lg:hidden lg:col-start-2 lg:row-start-2 lg:me-3 lg:mb-3 lg:rounded-shell lg:border lg:border-line-faint"
		>
			<h2
				className="flex h-12 shrink-0 items-center px-6 type-label-lg text-text-1"
				id={titleId}
			>
				Preview
			</h2>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="w-full max-w-196 p-4 sm:p-6 lg:p-8">{children}</div>
			</div>
		</section>
	);
}
