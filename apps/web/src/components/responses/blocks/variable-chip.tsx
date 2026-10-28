import type { ResponseVariable } from "@tripwire/contracts";
import type { MouseEvent } from "react";
import { Hide, Icon } from "#/components/glaze/icon";
import { VARIABLE_LABELS } from "#/components/responses/blocks/block-catalog";
import { cn } from "#/lib/glaze/utils";

export const VARIABLE_CHIP_CLASS =
	"inline-flex h-5.5 items-center gap-1 rounded-pill border border-line bg-field px-1.75 align-middle type-label-sm text-text-1";

export interface VariableChipProps {
	name: ResponseVariable;
	hidden: boolean;
	disabled: boolean;
	onInsert: (name: ResponseVariable) => void;
}

export function VariableChip({
	name,
	hidden,
	disabled,
	onInsert,
}: VariableChipProps) {
	const insert = () => onInsert(name);
	return (
		<button
			aria-label={`Insert ${VARIABLE_LABELS[name]}${hidden ? ", hidden from outsiders" : ""}`}
			className={cn(
				VARIABLE_CHIP_CLASS,
				"cursor-pointer bg-paper hover:bg-hover focus-visible:focus-sm disabled:cursor-default disabled:text-text-disabled disabled:hover:bg-paper",
			)}
			disabled={disabled}
			onClick={insert}
			onMouseDown={preventBlur}
			type="button"
		>
			{hidden ? <Icon className="text-text-3" icon={Hide} size={12} /> : null}
			{VARIABLE_LABELS[name]}
		</button>
	);
}

function preventBlur(event: MouseEvent) {
	event.preventDefault();
}
