import { Switch as BehaviorSwitch, SwitchThumb } from "@ui-sdk/react/switch";
import { useId } from "react";
import { type InteractionDetails, interactionDetails } from "./interaction";

type SwitchName =
	| { ariaLabel: string; ariaLabelledBy?: never; label?: never }
	| { ariaLabel?: never; ariaLabelledBy: string; label?: never }
	| { ariaLabel?: never; ariaLabelledBy?: never; label: string };

interface SwitchOptions {
	ariaDescribedBy?: string;
	description?: string;
	disabled?: boolean;
	form?: string;
	id?: string;
	invalid?: boolean;
	name?: string;
	onCheckedChange?: (checked: boolean, details: InteractionDetails) => void;
	pending?: boolean;
	readOnly?: boolean;
	required?: boolean;
	size?: "small" | "medium";
	value?: string;
}

type SwitchStateProps =
	| { checked: boolean; defaultChecked?: never }
	| { checked?: never; defaultChecked?: boolean };

export type SwitchProps = SwitchName & SwitchOptions & SwitchStateProps;

export function Switch({
	ariaLabel,
	ariaLabelledBy,
	ariaDescribedBy,
	checked,
	defaultChecked,
	description,
	disabled,
	form,
	id,
	invalid,
	label,
	name,
	onCheckedChange,
	pending = false,
	readOnly,
	required,
	size = "medium",
	value,
}: SwitchProps) {
	const labelId = useId();
	const descriptionId = useId();
	const generatedId = useId();
	const controlId = id ?? generatedId;
	const content = (
		<>
			{label ? (
				<span data-slot="switch-label" id={labelId}>
					{label}
				</span>
			) : null}
			{description ? (
				<span data-slot="switch-description" id={descriptionId}>
					{description}
				</span>
			) : null}
			<BehaviorSwitch
				aria-busy={pending || undefined}
				aria-describedby={
					ariaDescribedBy ?? (description ? descriptionId : undefined)
				}
				aria-label={ariaLabel}
				aria-labelledby={ariaLabelledBy ?? (label ? labelId : undefined)}
				aria-invalid={invalid || undefined}
				checked={checked}
				data-slot="switch"
				defaultChecked={defaultChecked}
				disabled={disabled || pending}
				form={form}
				id={controlId}
				name={name}
				onCheckedChange={(nextChecked, details) =>
					onCheckedChange?.(nextChecked, interactionDetails(details))
				}
				readOnly={readOnly}
				required={required}
				value={value}
			>
				<SwitchThumb data-slot="switch-thumb" />
			</BehaviorSwitch>
		</>
	);
	const fieldProps = {
		"data-disabled": disabled || pending ? "" : undefined,
		"data-invalid": invalid ? "" : undefined,
		"data-pending": pending ? "" : undefined,
		"data-readonly": readOnly ? "" : undefined,
		"data-size": size,
		"data-slot": "switch-field",
	} as const;
	return label ? (
		<label {...fieldProps} htmlFor={controlId}>
			{content}
		</label>
	) : (
		<span {...fieldProps}>{content}</span>
	);
}
