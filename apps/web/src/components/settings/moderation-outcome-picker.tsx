import {
	MODERATION_OUTCOME_LABELS,
	type ModerationOutcome,
	moderationOutcomeSchema,
} from "@tripwire/contracts";
import { useId } from "react";
import { Field, FieldLabel } from "#/design-system/ui/field";
import { Select } from "#/design-system/ui/select";
import { SupportingText } from "#/design-system/ui/typography";

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
			<FieldLabel htmlFor={id}>{label}</FieldLabel>
			<Select
				disabled={disabled}
				id={id}
				items={items}
				native
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
