import type { ReactNode } from "react";

export interface ChoiceOption<T extends string> {
	value: T;
	label: string;
	icon?: ReactNode;
}

/**
 * A single-choice question laid out as a grid of options. Native radios, so
 * arrow keys move the choice and the group reads as one question.
 */
export function ChoiceGrid<T extends string>({
	name,
	legend,
	hint,
	options,
	value,
	onChange,
	columns = 3,
}: {
	name: string;
	legend: string;
	hint?: string;
	options: readonly ChoiceOption<T>[];
	value: T | null;
	onChange: (value: T) => void;
	columns?: number;
}) {
	return (
		<fieldset data-layout-role="onboarding-field">
			<legend data-layout-role="onboarding-field-legend">
				<span>{legend}</span>
				{hint ? <span data-part="hint">{hint}</span> : null}
			</legend>
			<div data-columns={columns} data-layout-role="onboarding-choice-grid">
				{options.map((option) => (
					<label data-layout-role="onboarding-choice" key={option.value}>
						<input
							checked={value === option.value}
							name={name}
							onChange={() => onChange(option.value)}
							type="radio"
							value={option.value}
						/>
						{option.icon ? (
							<span aria-hidden="true" data-part="icon">
								{option.icon}
							</span>
						) : null}
						<span>{option.label}</span>
					</label>
				))}
			</div>
		</fieldset>
	);
}
