import { motion } from "motion/react";
import type { ReactNode } from "react";

const SPRING = { type: "spring", stiffness: 360, damping: 38 } as const;

// Concave (reverse-rounded) corner fillets so the sheet's top edge curves up
// into the surrounding inset instead of meeting it with a hard 90°.
const FILLET_LEFT =
	"radial-gradient(circle 14px at top right, transparent 13px, #000 14px)";
const FILLET_RIGHT =
	"radial-gradient(circle 14px at top left, transparent 13px, #000 14px)";

// The tab's bottom corners flare back out into the panel — the mirror of the
// sheet fillets — so the pill reads as one piece with the sheet.
const TAB_FILLET_LEFT =
	"radial-gradient(circle 14px at top left, transparent 13px, #000 14px)";
const TAB_FILLET_RIGHT =
	"radial-gradient(circle 14px at top right, transparent 13px, #000 14px)";

/**
 * The metric cards as a full-width sheet at the bottom of the shell. A centered
 * tab toggles it; opening grows the panel and pushes the page above it up
 * (it's an in-flow flex child, so the scroll area shrinks to make room).
 */
export function AnalyticsMetricsSheet({
	open,
	onOpenChange,
	metricCount,
	openLabel = "show metrics",
	closeLabel = "Close Metrics",
	children,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Count badge on the tab; omit to render the tab without one. */
	metricCount?: number;
	openLabel?: string;
	closeLabel?: string;
	children: ReactNode;
}) {
	return (
		<div className="relative z-20 flex shrink-0 flex-col items-center">
			<button
				type="button"
				onClick={() => onOpenChange(!open)}
				aria-expanded={open}
				className="relative flex items-center gap-2 rounded-t-xl bg-muted px-3 py-1.5"
			>
				<span className="font-semibold text-foreground text-sm tracking-tight">
					{open ? closeLabel : openLabel}
				</span>
				{typeof metricCount === "number" ? (
					<span className="rounded-full bg-surface-1 px-2 py-0.5 font-medium text-[11px] text-muted-foreground tabular-nums">
						{metricCount}
					</span>
				) : null}
				{/* Always flare the tab's base into the bottom — open or collapsed. */}
				<span
					aria-hidden
					className="pointer-events-none absolute right-full bottom-0 size-3.5 bg-muted"
					style={{
						maskImage: TAB_FILLET_LEFT,
						WebkitMaskImage: TAB_FILLET_LEFT,
					}}
				/>
				<span
					aria-hidden
					className="pointer-events-none absolute bottom-0 left-full size-3.5 bg-muted"
					style={{
						maskImage: TAB_FILLET_RIGHT,
						WebkitMaskImage: TAB_FILLET_RIGHT,
					}}
				/>
			</button>

			<div className="relative w-full">
				{open ? (
					<>
						<span
							aria-hidden
							className="pointer-events-none absolute top-0 left-0 size-3.5 -translate-y-full bg-muted"
							style={{ maskImage: FILLET_LEFT, WebkitMaskImage: FILLET_LEFT }}
						/>
						<span
							aria-hidden
							className="pointer-events-none absolute top-0 right-0 size-3.5 -translate-y-full bg-muted"
							style={{ maskImage: FILLET_RIGHT, WebkitMaskImage: FILLET_RIGHT }}
						/>
					</>
				) : null}

				<motion.div
					initial={false}
					animate={{ height: open ? "auto" : 0 }}
					transition={SPRING}
					className="w-full overflow-hidden bg-muted"
				>
					{children}
				</motion.div>
			</div>
		</div>
	);
}
