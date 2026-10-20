import type {
	BlockCommentMode,
	CommentOverride,
	CommentSurface,
	ResponseConfig,
	SuccessSurface,
	Verdict,
} from "@tripwire/contracts";
import type { ReactNode } from "react";
import { TemplateEditor } from "#/components/customize/template-editor";
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
import {
	SegmentedControl,
	SegmentedControlItem,
} from "#/components/glaze/ui/segmented-control";
import { Switch } from "#/components/glaze/ui/switch";
import { Textarea } from "#/components/glaze/ui/textarea";

function OutcomeComment({
	value,
	canEdit,
	onDraftText,
	onCommitText,
	onToggleButton,
}: {
	value: CommentOverride;
	canEdit: boolean;
	onDraftText: (text: string) => void;
	onCommitText: () => void;
	onToggleButton: (checked: boolean) => void;
}) {
	return (
		<div className="flex flex-col gap-3">
			<Field disabled={!canEdit}>
				<FieldLabel>Custom text</FieldLabel>
				<Textarea
					autoGrow
					maxRows={8}
					minRows={2}
					onBlur={onCommitText}
					onChange={(event) => onDraftText(event.target.value)}
					placeholder="Leave blank for the default comment"
					value={value.customText}
				/>
				<FieldDescription>
					Replaces the whole comment, so the rules and evidence won't show.
					Blank keeps the default.
				</FieldDescription>
			</Field>
			<Field orientation="horizontal">
				<FieldLabel>Show details button</FieldLabel>
				<Switch
					checked={value.showDetailsButton}
					disabled={!canEdit}
					onCheckedChange={onToggleButton}
					size="sm"
				/>
			</Field>
		</div>
	);
}

const SUCCESS_OPTIONS: { value: SuccessSurface; label: string }[] = [
	{ value: "silent", label: "Silent" },
	{ value: "ci-check", label: "Check only" },
	{ value: "comment", label: "Comment" },
];

const COMMENT_OPTIONS: { value: CommentSurface; label: string }[] = [
	{ value: "comment", label: "Comment" },
	{ value: "silent", label: "Silent" },
];

const MODE_OPTIONS: { value: BlockCommentMode; label: string }[] = [
	{ value: "full", label: "Full" },
	{ value: "one-liner-link", label: "One line per rule" },
	{ value: "link-only", label: "Link only" },
	{ value: "custom", label: "Custom" },
];

function Choice<T extends string>({
	options,
	value,
	onChange,
	disabled,
	label,
}: {
	options: { value: T; label: string }[];
	value: T;
	onChange: (value: T) => void;
	disabled: boolean;
	label: string;
}) {
	return (
		<SegmentedControl
			aria-label={label}
			className="w-full"
			disabled={disabled}
			fill
			onValueChange={(next) => onChange(next as T)}
			size="sm"
			value={value}
		>
			{options.map((option) => (
				<SegmentedControlItem key={option.value} value={option.value}>
					{option.label}
				</SegmentedControlItem>
			))}
		</SegmentedControl>
	);
}

function Section({
	title,
	titleId,
	verdict,
	onInteract,
	children,
}: {
	title: string;
	titleId: string;
	verdict: Verdict;
	onInteract: (verdict: Verdict) => void;
	children: ReactNode;
}) {
	return (
		<section
			aria-labelledby={titleId}
			className="flex flex-col gap-3"
			onClickCapture={() => onInteract(verdict)}
			onFocusCapture={() => onInteract(verdict)}
		>
			<h3 className="type-label" id={titleId}>
				{title}
			</h3>
			{children}
		</section>
	);
}

const TEMPLATE_PLACEHOLDER = "blocked: {{ruleName}}\n\n{{runUrl}}";

export interface ResponseConfigFormProps {
	config: ResponseConfig;
	canEdit: boolean;
	onChange: (config: ResponseConfig) => void;
	onDraft: (config: ResponseConfig) => void;
	onInteract: (verdict: Verdict) => void;
}

export function ResponseConfigForm({
	config,
	canEdit,
	onChange,
	onDraft,
	onInteract,
}: ResponseConfigFormProps) {
	const patch = (partial: Partial<ResponseConfig>) =>
		onChange({ ...config, ...partial });
	const patchBlockComment = (
		partial: Partial<ResponseConfig["blockComment"]>,
	) =>
		onChange({
			...config,
			blockComment: { ...config.blockComment, ...partial },
		});
	const patchPassComment = (partial: Partial<CommentOverride>) =>
		onChange({ ...config, passComment: { ...config.passComment, ...partial } });
	const draftPassComment = (partial: Partial<CommentOverride>) =>
		onDraft({ ...config, passComment: { ...config.passComment, ...partial } });
	const draftBlockComment = (partial: Partial<CommentOverride>) =>
		onDraft({
			...config,
			blockComment: { ...config.blockComment, ...partial },
		});
	const patchReviewComment = (partial: Partial<CommentOverride>) =>
		onChange({
			...config,
			reviewComment: { ...config.reviewComment, ...partial },
		});
	const draftReviewComment = (partial: Partial<CommentOverride>) =>
		onDraft({
			...config,
			reviewComment: { ...config.reviewComment, ...partial },
		});

	return (
		<div className="flex flex-col gap-6">
			<Section
				onInteract={onInteract}
				title="On a pass"
				titleId="response-on-pass"
				verdict="pass"
			>
				<Choice
					disabled={!canEdit}
					label="On a pass"
					onChange={(onSuccess) => patch({ onSuccess })}
					options={SUCCESS_OPTIONS}
					value={config.onSuccess}
				/>
				{config.onSuccess === "comment" ? (
					<OutcomeComment
						canEdit={canEdit}
						onCommitText={() => onChange(config)}
						onDraftText={(customText) => draftPassComment({ customText })}
						onToggleButton={(checked) =>
							patchPassComment({ showDetailsButton: checked })
						}
						value={config.passComment}
					/>
				) : null}
			</Section>

			<Section
				onInteract={onInteract}
				title="On a block"
				titleId="response-on-block"
				verdict="block"
			>
				<Choice
					disabled={!canEdit}
					label="On a block"
					onChange={(onBlock) => patch({ onBlock })}
					options={COMMENT_OPTIONS}
					value={config.onBlock}
				/>
				<p className="type-body-sm text-text-2">
					The check always blocks the merge. This only controls the comment.
				</p>
				{config.onBlock === "comment" ? (
					<div className="flex flex-col gap-3">
						<OutcomeComment
							canEdit={canEdit}
							onCommitText={() => onChange(config)}
							onDraftText={(customText) => draftBlockComment({ customText })}
							onToggleButton={(checked) =>
								patchBlockComment({ showDetailsButton: checked })
							}
							value={config.blockComment}
						/>
						<div className="flex flex-col gap-1">
							<h4 className="type-label" id="response-comment-shape">
								Comment shape
							</h4>
							<p className="type-body-sm text-text-2">
								Applies only when custom text is blank.
							</p>
						</div>
						<RadioGroup
							aria-labelledby="response-comment-shape"
							disabled={!canEdit}
							onValueChange={(mode) =>
								patchBlockComment({ mode: mode as BlockCommentMode })
							}
							value={config.blockComment.mode}
						>
							{MODE_OPTIONS.map((option) => (
								<RadioGroupOption
									key={option.value}
									label={option.label}
									value={option.value}
								/>
							))}
						</RadioGroup>
						{config.blockComment.mode === "one-liner-link" ? (
							<Field orientation="horizontal">
								<FieldLabel>Show rule names</FieldLabel>
								<Switch
									checked={config.blockComment.showRuleName}
									disabled={!canEdit}
									onCheckedChange={(checked) =>
										patchBlockComment({ showRuleName: checked })
									}
									size="sm"
								/>
							</Field>
						) : null}
						{config.blockComment.mode === "custom" ? (
							<TemplateEditor
								disabled={!canEdit}
								onCommit={() => onChange(config)}
								onDraft={(template) =>
									onDraft({
										...config,
										blockComment: { ...config.blockComment, template },
									})
								}
								placeholder={TEMPLATE_PLACEHOLDER}
								value={config.blockComment.template}
							/>
						) : null}
					</div>
				) : null}
			</Section>

			<Section
				onInteract={onInteract}
				title="Sent to review"
				titleId="response-on-review"
				verdict="needs_review"
			>
				<Choice
					disabled={!canEdit}
					label="Sent to review"
					onChange={(moderationQueued) => patch({ moderationQueued })}
					options={COMMENT_OPTIONS}
					value={config.moderationQueued}
				/>
				{config.moderationQueued === "comment" ? (
					<OutcomeComment
						canEdit={canEdit}
						onCommitText={() => onChange(config)}
						onDraftText={(customText) => draftReviewComment({ customText })}
						onToggleButton={(checked) =>
							patchReviewComment({ showDetailsButton: checked })
						}
						value={config.reviewComment}
					/>
				) : null}

				<Field
					className="border-line-faint border-t pt-3"
					orientation="horizontal"
				>
					<FieldContent>
						<FieldLabel>Review when a rule can't run</FieldLabel>
						<FieldDescription>
							{config.failClosedFallback
								? "A change that half its rules couldn't check goes to a human."
								: "Off. A change passes even when half its rules couldn't check it."}
						</FieldDescription>
					</FieldContent>
					<Switch
						checked={config.failClosedFallback}
						disabled={!canEdit}
						onCheckedChange={(checked) =>
							patch({ failClosedFallback: checked })
						}
						size="sm"
					/>
				</Field>
			</Section>
			{canEdit ? null : (
				<p className="type-body-sm text-text-2">
					Only org admins can change these settings.
				</p>
			)}
		</div>
	);
}
