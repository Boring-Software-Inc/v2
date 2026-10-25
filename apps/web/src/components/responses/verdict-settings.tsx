import type { RedactionPolicy, ResponseConfig } from "@tripwire/contracts";
import { blockCommentAddsDetail, wantsCheck } from "@tripwire/contracts";
import {
	RadioGroup,
	RadioGroupOption,
} from "#/components/glaze/ui/radio-group";
import { MessageEditor } from "#/components/responses/message-editor";
import { PreviewLinked } from "#/components/responses/preview-link";
import {
	blockContentChoice,
	blockDraftKey,
	type ContentChoice,
	type DraftKey,
	type OutcomeMeta,
	postsComment,
	readDraftKey,
} from "#/components/responses/responses-model";
import {
	SETTING_NESTED,
	SETTING_ROW,
	SettingFact,
	SettingSection,
	SettingSwitch,
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

export interface VerdictSettingsProps {
	outcome: OutcomeMeta;
	config: ResponseConfig;
	policy: RedactionPolicy;
	canEdit: boolean;
	editorEpoch: number;
	setField: ReturnType<typeof useSaveQueue>["setField"];
}

export function VerdictSettings({
	outcome,
	config,
	policy,
	canEdit,
	editorEpoch,
	setField,
}: VerdictSettingsProps) {
	const disabled = !canEdit;
	const commenting = postsComment(config, outcome);
	const isBlock = outcome.value === "block";
	const choice = blockContentChoice(config);
	const draftKey = blockDraftKey(config);
	const usesTemplate =
		isBlock && choice === "message" && draftKey === "blockComment.template";
	const blockReviewOnly =
		isBlock && commenting && !blockCommentAddsDetail(config, policy);

	const setChoice = (next: ContentChoice) => {
		if (next === choice) {
			return;
		}
		setField("blockComment.mode", next === "message" ? "custom" : next);
		if (next !== "message") {
			setField("blockComment.customText", "");
		}
	};

	const commitDraft = (key: DraftKey, value: string) => {
		setField(key, value);
	};

	return (
		<div className="flex flex-col gap-6">
			<SettingSection id={`comment-${outcome.value}`} title="Comment">
				<SettingSwitch
					checked={commenting}
					disabled={disabled}
					label="Post a comment"
					onChange={(on) =>
						setField(outcome.surface, on ? "comment" : "silent")
					}
					setting="post-comment"
				/>
				{blockReviewOnly ? (
					<p className="px-3 pb-1 type-body-sm text-text-2">
						At this redaction level, Tripwire posts only the review.
					</p>
				) : null}
				{commenting && isBlock ? (
					<>
						<RadioGroup
							aria-label="Comment content"
							className="gap-0.5"
							disabled={disabled}
							onValueChange={(value) => setChoice(value as ContentChoice)}
							value={choice}
						>
							{BLOCK_CHOICES.map((option) => (
								<PreviewLinked key={option.value} setting="content">
									<RadioGroupOption
										className={cn(SETTING_ROW, disabled && "cursor-default")}
										description={option.description}
										label={option.label}
										value={option.value}
									/>
								</PreviewLinked>
							))}
						</RadioGroup>
						{choice === "message" ? (
							<PreviewLinked setting="message">
								<div className={cn("py-2 pe-3", SETTING_NESTED)}>
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
					</>
				) : null}
				{commenting && !usesTemplate ? (
					<SettingSwitch
						checked={config[outcome.override].showDetailsButton}
						disabled={disabled}
						label="Link to the run"
						onChange={(on) =>
							setField(`${outcome.override}.showDetailsButton`, on)
						}
						setting="details-button"
					/>
				) : null}
			</SettingSection>
			<div aria-hidden className="mx-3 h-px bg-line" />
			<SettingSection id={`check-${outcome.value}`} title="Check run">
				<SettingFact
					label="Post a check run"
					setting="check-run"
					value={wantsCheck(config, outcome.verdict) ? "Always on" : "Off"}
				/>
			</SettingSection>
		</div>
	);
}
