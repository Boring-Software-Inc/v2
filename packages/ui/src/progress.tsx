import {
	Progress as BehaviorProgress,
	ProgressIndicator,
	ProgressLabel,
	ProgressTrack,
	ProgressValue,
} from "@ui-sdk/react/progress";

export interface ProgressProps {
	ariaLabel?: string;
	label?: string;
	max?: number;
	showHeader?: boolean;
	size?: "compact" | "default";
	value?: number | null;
	valueText?: string;
}

export function Progress({
	ariaLabel,
	label,
	max = 100,
	showHeader = true,
	size = "default",
	value,
	valueText,
}: ProgressProps) {
	const readingText = value == null ? undefined : valueText;
	return (
		<BehaviorProgress
			aria-label={ariaLabel ?? (showHeader ? undefined : label)}
			data-size={size}
			data-slot="progress"
			getValueLabel={readingText ? () => readingText : undefined}
			max={max}
			value={value}
		>
			{showHeader ? (
				<div data-slot="progress-header">
					{label ? (
						<ProgressLabel data-slot="progress-label">{label}</ProgressLabel>
					) : null}
					<ProgressValue data-slot="progress-value">
						{readingText}
					</ProgressValue>
				</div>
			) : null}
			<ProgressTrack data-slot="progress-track">
				<ProgressIndicator
					className="control-fill control-fill-x"
					data-positive={
						value != null && Number.isFinite(value) && value > 0
							? ""
							: undefined
					}
					data-slot="progress-indicator"
				/>
			</ProgressTrack>
		</BehaviorProgress>
	);
}
