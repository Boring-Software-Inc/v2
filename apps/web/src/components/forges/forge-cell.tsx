import type { ForgeId } from "@tripwire/contracts";
import { Button } from "@tripwire/ui/button";
import { notify } from "@tripwire/ui/toast";
import { useId } from "react";
import { ForgeMark } from "#/components/common/forge-marks";

export const FORGE_GRID = "grid grid-cols-2 composition-gap-standard";

/**
 * One blocked shape, not three. Every reason a forge can't be used right now (no
 * org in context, not an admin, install URL unavailable) collapses to `blocked`
 * with copy explaining which. The cell renders them identically, so a user
 * learns one affordance instead of three.
 */
export type ForgeCellState =
	| { kind: "loading" }
	| { kind: "unavailable" }
	| { kind: "ready"; pending?: boolean; onSelect: () => void }
	| { kind: "blocked"; title: string; body: string };

/**
 * One forge button, shared by the sign-in grid and the connect grid. Blocked
 * cells remain actions because their purpose is to reveal why the forge cannot
 * be used. Their accessible name and description carry that explanation before
 * activation, and the resulting toast gives pointer and keyboard users the
 * same next step.
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
	const reasonId = useId();
	if (state.kind === "loading") {
		return (
			<div className="grid w-full">
				<Button
					leadingIcon={<ForgeMark forge={id} />}
					pending
					variant="secondary"
				>
					{label}
				</Button>
			</div>
		);
	}
	if (state.kind === "unavailable") {
		return (
			<div className="grid w-full">
				<Button
					disabled
					focusableWhenDisabled
					leadingIcon={<ForgeMark forge={id} />}
					variant="secondary"
				>
					{label}
				</Button>
			</div>
		);
	}
	if (state.kind === "blocked") {
		return (
			<>
				<Button
					ariaLabel={`${label}. ${state.title}`}
					describedBy={reasonId}
					leadingIcon={<ForgeMark forge={id} />}
					onAction={() => {
						notify.show({
							description: state.body,
							id: `forge-blocked:${id}`,
							title: state.title,
						});
					}}
					variant="secondary"
				>
					{label}
				</Button>
				<span className="sr-only" id={reasonId}>
					{state.title}. {state.body}
				</span>
			</>
		);
	}
	return (
		<div className="grid w-full">
			<Button
				leadingIcon={<ForgeMark forge={id} />}
				onAction={state.onSelect}
				pending={state.pending ?? false}
				variant="secondary"
			>
				{label}
			</Button>
		</div>
	);
}
