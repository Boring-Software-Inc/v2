import type { ResponseConfig, Verdict } from "@tripwire/contracts";
import { type ReactNode, useId } from "react";
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
import {
	PreviewLinked,
	type PreviewSetting,
	usePreviewLink,
} from "#/components/customize/preview-link";
import { Checkbox } from "#/components/glaze/ui/checkbox";
import {
	RadioGroup,
	RadioGroupOption,
} from "#/components/glaze/ui/radio-group";
import type { useSaveQueue } from "#/components/save-queue";
import { cn } from "#/lib/glaze/utils";

const ROW = "rounded-panel px-3 py-2";
const NESTED = "ps-10";

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
		value: "link-only",
		label: "Link only",
		description: "Says it is blocked and links to the details.",
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
	const link = usePreviewLink();

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
		link.flash("content");
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
			<Section
				description="What Tripwire writes on the change request."
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
											className={cn(ROW, NESTED, disabled && "cursor-default")}
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
						{verdict === "block" && choice === "one-liner-link" ? (
							<Toggle
								checked={config.blockComment.showRuleName}
								description="Starts each line with the rule's name."
								disabled={disabled}
								label="Show rule names"
								nested
								onChange={(on) => setField("blockComment.showRuleName", on)}
								setting="rule-names"
							/>
						) : null}
						{usesTemplate && choice === "message" ? null : (
							<Toggle
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
			</Section>

			<Section
				description="The status Tripwire reports next to the merge button."
				id={`check-${verdict}`}
				title="Check run"
			>
				{verdict === "pass" ? (
					<Toggle
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
					<Toggle
						checked
						description="Always on. Holds the merge when branch protection requires the tripwire check."
						disabled
						label="Post a check run"
						onChange={() => undefined}
						setting="check-run"
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
		<section aria-labelledby={id} className="flex flex-col gap-2">
			<header className="flex flex-col gap-0.5 px-3">
				<h2 className="type-heading-sm" id={id}>
					{title}
				</h2>
				<p className="type-body-sm text-text-2">{description}</p>
			</header>
			<div className="flex flex-col gap-0.5">{children}</div>
		</section>
	);
}

function Toggle({
	label,
	description,
	checked,
	disabled,
	setting,
	nested = false,
	onChange,
}: {
	label: string;
	description: string;
	checked: boolean;
	disabled: boolean;
	setting: PreviewSetting;
	nested?: boolean;
	onChange: (checked: boolean) => void;
}) {
	const link = usePreviewLink();
	const id = useId();
	return (
		<PreviewLinked setting={setting}>
			<label
				htmlFor={id}
				className={cn(
					"flex items-start gap-3",
					ROW,
					nested && NESTED,
					disabled ? "cursor-default" : "cursor-pointer",
				)}
			>
				<Checkbox
					aria-describedby={`${id}-d`}
					aria-labelledby={`${id}-l`}
					id={id}
					checked={checked}
					disabled={disabled}
					onCheckedChange={(next) => {
						onChange(next === true);
						link.flash(setting);
					}}
				/>
				<span className="flex min-w-0 flex-col gap-0.5">
					<span
						className={cn(
							"type-label",
							disabled ? "text-text-disabled" : "text-text-1",
						)}
						id={`${id}-l`}
					>
						{label}
					</span>
					<span
						className={cn(
							"type-body-sm",
							disabled ? "text-text-disabled" : "text-text-2",
						)}
						id={`${id}-d`}
					>
						{description}
					</span>
				</span>
			</label>
		</PreviewLinked>
	);
}
