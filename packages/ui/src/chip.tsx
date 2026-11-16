import { Button as BehaviorButton } from "@ui-sdk/react/button";
import { Toggle as BehaviorToggle } from "@ui-sdk/react/toggle";
import type { ReactNode, RefObject } from "react";
import {
	type InteractionDetails,
	interactionDetails,
	interactionFromEvent,
} from "./interaction";

const CHIP_CLASS =
	"group/chip relative inline-flex h-(--control-sm) min-w-0 items-center rounded-pill border px-2.5 text-text-1 transition-[background-color,border-color,color,scale] duration-(--dur-state) ease-out hover:border-line-strong focus-sm disabled:cursor-not-allowed disabled:border-line-faint disabled:text-text-disabled";

const COUNT_FORMAT = new Intl.NumberFormat("en-US");

export interface ChoiceChipProps {
	count?: number;
	disabled?: boolean;
	label: string;
	onPressedChange: (pressed: boolean, details: InteractionDetails) => void;
	pressed: boolean;
}

export function ChoiceChip({
	count,
	disabled,
	label,
	onPressedChange,
	pressed,
}: ChoiceChipProps) {
	return (
		<BehaviorToggle
			className={`${CHIP_CLASS} gap-1.5 border-line-control type-label-sm aria-pressed:bg-pressed`}
			disabled={disabled}
			onPressedChange={(next, details) =>
				onPressedChange(next, interactionDetails(details))
			}
			pressed={pressed}
		>
			<span className="min-w-0 truncate">{label}</span>
			{count === undefined ? null : (
				<span className="data text-text-2" data-slot="chip-count">
					{COUNT_FORMAT.format(count)}
				</span>
			)}
		</BehaviorToggle>
	);
}

export interface RemovableChipProps {
	disabled?: boolean;
	focusAfterEmpty: RefObject<HTMLElement | null>;
	label: string;
	onRemove: (details: InteractionDetails) => void;
	removeLabel: string;
}

export function RemovableChip({
	disabled,
	focusAfterEmpty,
	label,
	onRemove,
	removeLabel,
}: RemovableChipProps) {
	const remove = (button: HTMLElement, details: InteractionDetails) => {
		const group = button.closest("[data-slot=chip-group]");
		const buttons = group?.querySelectorAll<HTMLElement>(
			"[data-slot=chip-remove]:not(:disabled)",
		);
		const index = buttons ? Array.from(buttons).indexOf(button) : -1;
		const next =
			index >= 0 ? (buttons?.[index + 1] ?? buttons?.[index - 1]) : undefined;
		onRemove(details);
		if (!group) return;
		requestAnimationFrame(() => {
			if (next?.isConnected) next.focus();
			else focusAfterEmpty.current?.focus();
		});
	};

	return (
		<span
			className={`${CHIP_CLASS} gap-1 border-line pe-(--shell-inset) type-body-sm`}
			data-slot="chip-value"
		>
			<span className="min-w-0 truncate">{label}</span>
			<BehaviorButton
				aria-label={removeLabel}
				className="relative inline-flex size-5 shrink-0 items-center justify-center rounded-pill text-text-2 transition-colors hover:not-disabled:bg-hover hover:not-disabled:text-text-1 focus-sm disabled:cursor-not-allowed disabled:text-text-disabled after:absolute after:-inset-1"
				disabled={disabled}
				render={(props) => <button {...props} data-slot="chip-remove" />}
				onClick={(event, details) =>
					remove(event.currentTarget, interactionDetails(details))
				}
				onKeyDown={(event) => {
					if (event.key === "Backspace" || event.key === "Delete") {
						event.preventDefault();
						remove(
							event.currentTarget,
							interactionFromEvent(event.nativeEvent),
						);
					}
				}}
				type="button"
			>
				<svg aria-hidden viewBox="0 0 12 12" className="size-3">
					<title>Remove</title>
					<path
						d="m3 3 6 6m0-6L3 9"
						fill="none"
						stroke="currentColor"
						strokeLinecap="round"
					/>
				</svg>
			</BehaviorButton>
		</span>
	);
}

export interface ChipGroupProps {
	children: ReactNode;
	label: string;
}

export function ChipGroup({ children, label }: ChipGroupProps) {
	return (
		<fieldset
			className="m-0 flex min-w-0 flex-wrap items-center gap-1 border-0 p-0"
			data-slot="chip-group"
		>
			<legend className="ui-sr-only">{label}</legend>
			{children}
		</fieldset>
	);
}
