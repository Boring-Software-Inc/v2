import {
	NumberInput as BehaviorNumberInput,
	NumberInputControl,
	NumberInputDecrement,
	NumberInputGroup,
	NumberInputIncrement,
} from "@ui-sdk/react/number-input";
import { useId } from "react";
import type { AccessibleName } from "./accessible-name";
import { Add, Icon, Subtract } from "./icon";
import { type InteractionDetails, interactionDetails } from "./interaction";

interface NumberInputOptions {
	ariaDescribedBy?: string;
	disabled?: boolean;
	invalid?: boolean;
	max?: number;
	min?: number;
	name?: string;
	onValueChange?: (value: number | null, details: InteractionDetails) => void;
	readOnly?: boolean;
	required?: boolean;
	step?: number;
	unit?: string;
}

type NumberInputState =
	| { defaultValue?: number | null; value?: never }
	| { defaultValue?: never; value: number | null };

export type NumberInputProps = NumberInputOptions &
	NumberInputState &
	AccessibleName;

export function NumberInput({
	ariaDescribedBy,
	ariaLabel,
	ariaLabelledBy,
	defaultValue,
	disabled,
	invalid,
	max,
	min,
	name,
	onValueChange,
	readOnly,
	required,
	step,
	unit,
	value,
}: NumberInputProps) {
	const decrementActionId = useId();
	const incrementActionId = useId();
	return (
		<BehaviorNumberInput
			data-slot="number-input"
			defaultValue={defaultValue}
			disabled={disabled}
			max={max}
			min={min}
			name={name}
			onValueChange={(nextValue, details) =>
				onValueChange?.(nextValue, interactionDetails(details))
			}
			readOnly={readOnly}
			required={required}
			step={step}
			value={value}
		>
			<NumberInputGroup data-slot="number-input-group">
				{ariaLabelledBy ? (
					<>
						<span className="ui-sr-only" id={decrementActionId}>
							Decrease
						</span>
						<span className="ui-sr-only" id={incrementActionId}>
							Increase
						</span>
					</>
				) : null}
				<NumberInputDecrement
					aria-label={ariaLabel ? `Decrease ${ariaLabel}` : undefined}
					aria-labelledby={
						ariaLabelledBy
							? `${decrementActionId} ${ariaLabelledBy}`
							: undefined
					}
					data-slot="number-input-step"
				>
					<Icon icon={Subtract} />
				</NumberInputDecrement>
				<span data-slot="number-input-value">
					<NumberInputControl
						aria-describedby={ariaDescribedBy}
						aria-invalid={invalid || undefined}
						aria-label={ariaLabel}
						aria-labelledby={ariaLabelledBy}
						data-slot="number-input-control"
						render={(props, state) => (
							<input
								{...props}
								aria-valuemax={max}
								aria-valuemin={min}
								aria-valuenow={state.value ?? undefined}
								role="spinbutton"
							/>
						)}
					/>
					{unit ? (
						<span aria-hidden="true" data-slot="number-input-unit">
							{unit}
						</span>
					) : null}
				</span>
				<NumberInputIncrement
					aria-label={ariaLabel ? `Increase ${ariaLabel}` : undefined}
					aria-labelledby={
						ariaLabelledBy
							? `${incrementActionId} ${ariaLabelledBy}`
							: undefined
					}
					data-slot="number-input-step"
				>
					<Icon icon={Add} />
				</NumberInputIncrement>
			</NumberInputGroup>
		</BehaviorNumberInput>
	);
}
