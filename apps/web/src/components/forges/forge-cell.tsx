import type { ForgeId } from "@tripwire/contracts";
import { ForgeMark } from "#/components/common/forge-marks";
import { Button } from "#/components/ui/button";
import { Spinner } from "#/components/ui/spinner";
import { toast } from "#/components/ui/toast";

/** 162px cells + a 4px gutter inside the 328px card body — the 2×2 from Paper.
 * `grid-cols-2` derives both from the container width instead of hard-coding
 * them, so the same grid drops into the login card and the connect dialog. */
export const FORGE_GRID = "relative grid grid-cols-2 gap-1";

const FORGE_BUTTON =
	"relative h-9 w-full gap-1.5 rounded-sm border border-border bg-surface-1 px-3 text-foreground text-sm";

/**
 * Two shapes, not four. Every reason a forge can't be used right now — no
 * adapter built, no org in context, not an admin, install URL unavailable —
 * collapses to `blocked` with copy explaining which. The cell renders them
 * identically, so a user learns one affordance instead of four.
 */
export type ForgeCellState =
	| { kind: "ready"; pending?: boolean; onSelect: () => void }
	| { kind: "blocked"; title: string; body: string };

/**
 * One forge button, shared by the sign-in grid and the connect grid. Blocked
 * cells are deliberately NOT `disabled` — a disabled button gets
 * `pointer-events-none` and would swallow the click, so unavailability is
 * carried by `aria-disabled` + the not-allowed cursor while the click still
 * reaches the toast that says why. Stays focusable, so keyboard users get the
 * same explanation.
 */
export function ForgeCell({
	id,
	label,
	state,
}: {
	id: ForgeId;
	label: string;
	state: ForgeCellState;
}) {
	if (state.kind === "blocked") {
		return (
			<Button
				aria-disabled="true"
				className={`${FORGE_BUTTON} cursor-not-allowed opacity-50 hover:bg-surface-1 active:scale-100`}
				iconLeft={<ForgeMark forge={id} />}
				onClick={() => {
					toast.info({
						title: state.title,
						body: state.body,
						dedupeKey: `forge-blocked:${id}`,
					});
				}}
			>
				{label}
			</Button>
		);
	}
	return (
		<Button
			className={`${FORGE_BUTTON} hover:bg-secondary`}
			disabled={state.pending}
			iconLeft={
				state.pending ? <Spinner size={16} /> : <ForgeMark forge={id} />
			}
			onClick={state.onSelect}
		>
			{label}
		</Button>
	);
}
