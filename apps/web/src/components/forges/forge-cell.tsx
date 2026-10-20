import type { ForgeId } from "@tripwire/contracts";
import { ForgeMark } from "#/components/common/forge-marks";
import { Button } from "#/components/glaze/ui/button";
import { toast } from "#/components/glaze/ui/toast";

export const FORGE_GRID = "grid grid-cols-2 gap-2";

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
				className="w-full"
				onClick={() => {
					toast(state.title, {
						description: state.body,
						id: `forge-blocked:${id}`,
					});
				}}
				variant="secondary"
			>
				<ForgeMark forge={id} />
				{label}
			</Button>
		);
	}
	return (
		<Button
			className="w-full"
			onClick={state.onSelect}
			pending={state.pending ?? false}
			variant="secondary"
		>
			<ForgeMark forge={id} />
			{label}
		</Button>
	);
}
