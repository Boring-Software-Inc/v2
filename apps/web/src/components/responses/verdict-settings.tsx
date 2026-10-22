import type { ResponseConfig, Verdict } from "@tripwire/contracts";
import {
	RadioGroup,
	RadioGroupOption,
} from "#/components/glaze/ui/radio-group";
import { MessageEditor } from "#/components/responses/message-editor";
import { PreviewLinked } from "#/components/responses/preview-link";
import {
	type ContentChoice,
	commentKey,
	contentChoice,
	type DraftKey,
	messageDraftKey,
	overrideKey,
	postsComment,
	readDraftKey,
} from "#/components/responses/responses-model";
import {
	SETTING_NESTED,
	SETTING_ROW,
	SettingSection,
	SettingToggle,
} from "#/components/responses/setting-rows";
import type { useSaveQueue } from "#/components/save-queue";
import { cn } from "#/lib/glaze/utils";

const BLOCK_CHOICES: {
	value: ContentChoice;
	label: string;
	description: string;
}[] = [
	{
		value: "full",
		label: "All details",
		description: "Each rule that blocked it, why, and how to fix it.",
	},
	{
		value: "one-liner-link",
		label: "One line per rule",
		description: "One short line for each rule that blocked it.",
	},
	{
		value: "message",
		label: "Write your own",
		description: "Post your text instead of the default comment.",
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
		label: "Write your own",
		description: "Post your text instead of the default comment.",
	},
];

export interface VerdictSettingsProps {
	verdict: Verdict;
	config: ResponseConfig;
	canEdit: boolean;
	messageChosen: boolean;
	editorEpoch: number;
	onMessageChosen: (verdict: Verdict, chosen: boolean) => void;
	setField: ReturnType<typeof useSaveQueue>["setField"];
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
		<div className="flex flex-col gap-7">
			<SettingSection
				description="What Tripwire writes on the change request."
				id={`comment-${verdict}`}
				title="Comment"
			>
				<SettingToggle
					checked={commenting}
					description={
						verdict === "pass"
							? "Off by default. A pass usually needs no reply."
							: "Tells the contributor what happened."
					}
					disabled={disabled}
					label="Post a comment"
					onChange={setComment}
					setting="post-comment"
				/>
				{commenting ? (
					<>
						<RadioGroup
							aria-label="Comment content"
							className="gap-0.5"
							disabled={disabled}
							onValueChange={(value) => setChoice(value as ContentChoice)}
							value={choice}
						>
							{(verdict === "block" ? BLOCK_CHOICES : OUTCOME_CHOICES).map(
								(option) => (
									<PreviewLinked key={option.value} setting="content">
										<RadioGroupOption
											className={cn(
												SETTING_ROW,
												SETTING_NESTED,
												disabled && "cursor-default",
											)}
											description={option.description}
											label={option.label}
											value={option.value}
										/>
									</PreviewLinked>
								),
							)}
						</RadioGroup>
						{choice === "message" ? (
							<PreviewLinked setting="message">
								<div className="py-2 ps-10 pe-3">
									<MessageEditor
										disabled={disabled}
										draftKey={draftKey}
										initial={readDraftKey(config, draftKey)}
										key={`${draftKey}-${editorEpoch}`}
										onCommit={commitDraft}
										withVariables={usesTemplate}
									/>
								</div>
							</PreviewLinked>
						) : null}
						{usesTemplate && choice === "message" ? null : (
							<SettingToggle
								checked={config[override].showDetailsButton}
								description="Links to the run on Tripwire, with the details folded under it."
								disabled={disabled}
								label="Show the details button"
								nested
								onChange={(on) => setField(`${override}.showDetailsButton`, on)}
								setting="details-button"
							/>
						)}
					</>
				) : null}
			</SettingSection>

			<SettingSection
				description="The status Tripwire reports next to the merge button."
				id={`check-${verdict}`}
				title="Check run"
			>
				{verdict === "pass" ? (
					<SettingToggle
						checked={config.onSuccess !== "silent"}
						description={
							config.onSuccess === "comment"
								? "Stays on while Post a comment is on."
								: "Marks the change request as passed."
						}
						disabled={disabled || config.onSuccess === "comment"}
						label="Post a check run"
						onChange={(on) => setField("onSuccess", on ? "ci-check" : "silent")}
						setting="check-run"
					/>
				) : (
					<SettingToggle
						checked
						description="Always on. Holds the merge when branch protection requires the tripwire check."
						disabled
						label="Post a check run"
						onChange={() => undefined}
						setting="check-run"
					/>
				)}
			</SettingSection>
		</div>
	);
}
