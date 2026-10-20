import type { ResponseConfig, Verdict } from "@tripwire/contracts";
import type { ReactNode } from "react";
import {
	type ContentChoice,
	commentKey,
	contentChoice,
	type DraftKey,
	messageDraftKey,
	overrideKey,
	postsComment,
	readDraftKey,
} from "#/components/customize/customize-model";
import { MessageEditor } from "#/components/customize/message-editor";
import { Checkbox } from "#/components/glaze/ui/checkbox";
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldLabel,
} from "#/components/glaze/ui/field";
import {
	RadioGroup,
	RadioGroupOption,
} from "#/components/glaze/ui/radio-group";

const BLOCK_CHOICES: {
	value: ContentChoice;
	label: string;
	description: string;
}[] = [
	{
		value: "full",
		label: "Full",
		description: "Each failed rule with its reason and how to fix it.",
	},
	{
		value: "one-liner-link",
		label: "One line per rule",
		description: "A short line for each failed rule.",
	},
	{
		value: "link-only",
		label: "Link only",
		description: "The verdict and a link to the run.",
	},
	{
		value: "message",
		label: "Own message",
		description: "Your text, with the run's details filled in.",
	},
];

const OUTCOME_CHOICES: {
	value: ContentChoice;
	label: string;
	description: string;
}[] = [
	{
		value: "full",
		label: "Default",
		description: "Tripwire's standard comment for this verdict.",
	},
	{
		value: "message",
		label: "Own message",
		description: "Your text replaces the comment.",
	},
];

export interface VerdictSettingsProps {
	verdict: Verdict;
	config: ResponseConfig;
	canEdit: boolean;
	messageChosen: boolean;
	editorEpoch: number;
	onMessageChosen: (verdict: Verdict, chosen: boolean) => void;
	setField: (key: string, value: unknown) => void;
	rememberMessage: (verdict: Verdict, text: string) => void;
	recallMessage: (verdict: Verdict) => string;
}

export function VerdictSettings({
	verdict,
	config,
	canEdit,
	messageChosen,
	editorEpoch,
	onMessageChosen,
	setField,
	rememberMessage,
	recallMessage,
}: VerdictSettingsProps) {
	const disabled = !canEdit;
	const commenting = postsComment(config, verdict);
	const choice = contentChoice(config, verdict, messageChosen);
	const override = overrideKey(verdict);
	const draftKey = messageDraftKey(config, verdict);
	const usesTemplate = draftKey === "blockComment.template";

	const setComment = (on: boolean) => {
		if (verdict === "pass") {
			setField("onSuccess", on ? "comment" : "ci-check");
			return;
		}
		setField(commentKey(verdict), on ? "comment" : "silent");
	};

	const setChoice = (next: ContentChoice) => {
		if (next === choice) {
			return;
		}
		if (verdict === "block") {
			setField("blockComment.mode", next === "message" ? "custom" : next);
			if (next !== "message") {
				setField("blockComment.customText", "");
			}
			return;
		}
		if (next === "message") {
			onMessageChosen(verdict, true);
			setField(`${override}.customText`, recallMessage(verdict));
			return;
		}
		rememberMessage(verdict, config[override].customText);
		onMessageChosen(verdict, false);
		setField(`${override}.customText`, "");
	};

	const commitDraft = (key: DraftKey, value: string) => {
		setField(key, value);
	};

	return (
		<div className="flex flex-col gap-6">
			<Section
				description="What Tripwire writes on the pull request."
				id={`comment-${verdict}`}
				title="Comment"
			>
				<Toggle
					checked={commenting}
					description={
						verdict === "pass"
							? "Off by default. A pass usually needs no reply."
							: "Tells the contributor what happened."
					}
					disabled={disabled}
					label="Post a comment"
					onChange={setComment}
				/>
				{commenting ? (
					<>
						<RadioGroup
							aria-label="Comment content"
							disabled={disabled}
							onValueChange={(value) => setChoice(value as ContentChoice)}
							value={choice}
						>
							{(verdict === "block" ? BLOCK_CHOICES : OUTCOME_CHOICES).map(
								(option) => (
									<RadioGroupOption
										description={option.description}
										key={option.value}
										label={option.label}
										value={option.value}
									/>
								),
							)}
						</RadioGroup>
						{choice === "message" ? (
							<MessageEditor
								disabled={disabled}
								draftKey={draftKey}
								initial={readDraftKey(config, draftKey)}
								key={`${draftKey}-${editorEpoch}`}
								onCommit={commitDraft}
								withVariables={usesTemplate}
							/>
						) : null}
						{verdict === "block" && choice === "one-liner-link" ? (
							<Toggle
								checked={config.blockComment.showRuleName}
								description="Starts each line with the rule's name."
								disabled={disabled}
								label="Show rule names"
								onChange={(on) => setField("blockComment.showRuleName", on)}
							/>
						) : null}
						{usesTemplate && choice === "message" ? null : (
							<Toggle
								checked={config[override].showDetailsButton}
								description="Links to the run on Tripwire, with the details folded under it."
								disabled={disabled}
								label="Show the details button"
								onChange={(on) => setField(`${override}.showDetailsButton`, on)}
							/>
						)}
					</>
				) : null}
			</Section>

			<Section
				description="The status in the pull request's merge box."
				id={`check-${verdict}`}
				title="Check run"
			>
				{verdict === "pass" ? (
					<Toggle
						checked={config.onSuccess !== "silent"}
						description={
							config.onSuccess === "comment"
								? "Always posts while a comment does."
								: "Marks the pull request as passing."
						}
						disabled={disabled || config.onSuccess === "comment"}
						label="Post a check run"
						onChange={(on) => setField("onSuccess", on ? "ci-check" : "silent")}
					/>
				) : (
					<Toggle
						checked
						description={
							verdict === "block"
								? "Always posts. The check is what blocks the merge."
								: "Always posts. It holds the merge until a person decides."
						}
						disabled
						label="Post a check run"
						onChange={() => undefined}
					/>
				)}
			</Section>
		</div>
	);
}

function Section({
	id,
	title,
	description,
	children,
}: {
	id: string;
	title: string;
	description: string;
	children: ReactNode;
}) {
	return (
		<section aria-labelledby={id} className="flex flex-col gap-3">
			<header className="flex flex-col gap-0.5">
				<h2 className="type-heading-sm" id={id}>
					{title}
				</h2>
				<p className="type-body-sm text-text-2">{description}</p>
			</header>
			{children}
		</section>
	);
}

function Toggle({
	label,
	description,
	checked,
	disabled,
	onChange,
}: {
	label: string;
	description: string;
	checked: boolean;
	disabled: boolean;
	onChange: (checked: boolean) => void;
}) {
	return (
		<Field disabled={disabled} orientation="horizontal">
			<Checkbox
				checked={checked}
				onCheckedChange={(next) => onChange(next === true)}
			/>
			<FieldContent>
				<FieldLabel>{label}</FieldLabel>
				<FieldDescription>{description}</FieldDescription>
			</FieldContent>
		</Field>
	);
}
