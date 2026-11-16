import {
	Checkbox as BehaviorCheckbox,
	CheckboxGroup as BehaviorCheckboxGroup,
	CheckboxIndicator,
} from "@ui-sdk/react/checkbox";
import { useId } from "react";
import { type InteractionDetails, interactionDetails } from "./interaction";

export type CheckboxState = boolean | "indeterminate";

type CheckboxName =
	| { ariaLabel: string; ariaLabelledBy?: never; label?: never }
	| { ariaLabel?: never; ariaLabelledBy: string; label?: never }
	| { ariaLabel?: never; ariaLabelledBy?: never; label: string };

interface CheckboxOptions {
	ariaDescribedBy?: string;
	description?: string;
	disabled?: boolean;
	form?: string;
	id?: string;
	invalid?: boolean;
	name?: string;
	onCheckedChange?: (
		checked: CheckboxState,
		details: InteractionDetails,
	) => void;
	readOnly?: boolean;
	required?: boolean;
	size?: "small" | "medium";
	value?: string;
}

type CheckboxStateProps =
	| { checked: CheckboxState; defaultChecked?: never }
	| { checked?: never; defaultChecked?: CheckboxState };

export type CheckboxProps = CheckboxName & CheckboxOptions & CheckboxStateProps;

export function Checkbox({
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
	readOnly,
	required,
	size = "medium",
	value,
}: CheckboxProps) {
	const labelId = useId();
	const descriptionId = useId();
	const generatedId = useId();
	const controlId = id ?? generatedId;
	const content = (
		<>
			<BehaviorCheckbox
				aria-describedby={
					ariaDescribedBy ?? (description ? descriptionId : undefined)
				}
				aria-label={ariaLabel}
				aria-labelledby={ariaLabelledBy ?? (label ? labelId : undefined)}
				aria-invalid={invalid || undefined}
				checked={checked}
				data-size={size}
				data-slot="checkbox"
				defaultChecked={defaultChecked}
				disabled={disabled}
				form={form}
				id={controlId}
				name={name}
				onCheckedChange={(nextChecked, details) => {
					onCheckedChange?.(nextChecked, interactionDetails(details));
				}}
				readOnly={readOnly}
				required={required}
				value={value}
			>
				<CheckboxIndicator data-slot="checkbox-indicator">
					{(state) => (state.indeterminate ? "−" : "✓")}
				</CheckboxIndicator>
			</BehaviorCheckbox>
			{label ? (
				<span data-slot="checkbox-label" id={labelId}>
					{label}
				</span>
			) : null}
			{description ? (
				<span data-slot="checkbox-description" id={descriptionId}>
					{description}
				</span>
			) : null}
		</>
	);
	return label ? (
		<label
			data-disabled={disabled ? "" : undefined}
			data-invalid={invalid ? "" : undefined}
			data-readonly={readOnly ? "" : undefined}
			data-slot="checkbox-field"
			htmlFor={controlId}
		>
			{content}
		</label>
	) : (
		<span
			data-disabled={disabled ? "" : undefined}
			data-invalid={invalid ? "" : undefined}
			data-readonly={readOnly ? "" : undefined}
			data-slot="checkbox-field"
		>
			{content}
		</span>
	);
}

export interface CheckboxGroupOption {
	description?: string;
	disabled?: boolean;
	label: string;
	value: string;
}

interface CheckboxGroupOptions {
	ariaLabel: string;
	disabled?: boolean;
	form?: string;
	invalid?: boolean;
	name?: string;
	onValueChange?: (value: string[], details: InteractionDetails) => void;
	options: readonly CheckboxGroupOption[];
	readOnly?: boolean;
	required?: boolean;
}

type CheckboxGroupStateProps =
	| { value: string[]; defaultValue?: never }
	| { value?: never; defaultValue?: string[] };

export type CheckboxGroupProps = CheckboxGroupOptions & CheckboxGroupStateProps;

export function CheckboxGroup({
	ariaLabel,
	defaultValue,
	disabled,
	form,
	invalid,
	name,
	onValueChange,
	options,
	readOnly,
	required,
	value,
}: CheckboxGroupProps) {
	return (
		<BehaviorCheckboxGroup
			allValues={options.map((option) => option.value)}
			aria-label={ariaLabel}
			aria-invalid={invalid || undefined}
			data-slot="checkbox-group"
			defaultValue={defaultValue}
			disabled={disabled}
			form={form}
			name={name}
			onValueChange={(nextValue, details) =>
				onValueChange?.(nextValue, interactionDetails(details))
			}
			readOnly={readOnly}
			required={required}
			value={value}
		>
			{options.map((option) => (
				<Checkbox
					description={option.description}
					disabled={disabled || option.disabled}
					invalid={invalid}
					key={option.value}
					label={option.label}
					readOnly={readOnly}
					value={option.value}
				/>
			))}
		</BehaviorCheckboxGroup>
	);
}
