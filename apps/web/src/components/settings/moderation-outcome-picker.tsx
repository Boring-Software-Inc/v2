import {
	MODERATION_OUTCOME_LABELS,
	type ModerationOutcome,
	moderationOutcomeSchema,
} from "@tripwire/contracts";
import { Field, FieldLabel } from "@tripwire/ui/field";
import { Select } from "@tripwire/ui/select";
import { SupportingText } from "@tripwire/ui/typography";
import { useId } from "react";

export function ModerationOutcomePicker({
	label,
	value,
	disabled,
	inheritLabel,
	defaultLabel,
	onChange,
}: {
	label: string;
	value: ModerationOutcome | "inherit" | null;
	disabled: boolean;
	inheritLabel?: string;
	defaultLabel?: string;
	onChange: (outcome: ModerationOutcome | "inherit" | null) => void;
}) {
	const id = useId();
	const items = [
		...(defaultLabel ? [{ value: "default", label: defaultLabel }] : []),
		...(inheritLabel ? [{ value: "inherit", label: inheritLabel }] : []),
		...moderationOutcomeSchema.options.map((outcome) => ({
			value: outcome,
			label: MODERATION_OUTCOME_LABELS[outcome],
		})),
	];

	return (
		<Field>
			<FieldLabel>{label}</FieldLabel>
			<Select
				ariaLabel={label}
				disabled={disabled}
				id={id}
				options={items}
				mode="native"
				onValueChange={(next) => {
					if (next === "default") onChange(null);
					else if (next === "inherit") onChange(next);
					else {
						const outcome = moderationOutcomeSchema.safeParse(next);
						if (outcome.success) onChange(outcome.data);
					}
				}}
				value={value ?? "default"}
			/>
		</Field>
	);
}

export function ModerationOutcomeHelp() {
	return (
		<SupportingText>
			Warn leaves a comment. Human review sends the contribution to a
			maintainer. Block locks an issue or fails the pull request check and
			requests changes. Close closes either.
		</SupportingText>
	);
}
