import type {
	BlockCommentMode,
	CommentSurface,
	ResponseConfig,
	SuccessSurface,
	Verdict,
} from "@tripwire/contracts";
import { TemplateEditor } from "#/components/customize/template-editor";
import { Switch } from "#/components/ui/switch";
import { cn } from "#/lib/utils";

const EYEBROW_CLASS =
	"font-medium text-[11px] text-muted-foreground uppercase tracking-wide";

const SUCCESS_OPTIONS: { value: SuccessSurface; label: string }[] = [
	{ value: "silent", label: "silent" },
	{ value: "ci-check", label: "check only" },
	{ value: "comment", label: "comment" },
];

const COMMENT_OPTIONS: { value: CommentSurface; label: string }[] = [
	{ value: "comment", label: "comment" },
	{ value: "silent", label: "silent" },
];

const MODE_OPTIONS: { value: BlockCommentMode; label: string }[] = [
	{ value: "full", label: "full" },
	{ value: "one-liner-link", label: "one line per rule" },
	{ value: "link-only", label: "link only" },
	{ value: "custom", label: "custom" },
];

/** The activity feed's filter pills, made a controlled group. */
function PillGroup<T extends string>({
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
		<fieldset aria-label={label} className="flex flex-wrap gap-1.5">
			{options.map((option) => (
				<button
					aria-pressed={value === option.value}
					className={cn(
						"rounded-full px-2.5 py-1 font-medium text-xs transition-colors",
						value === option.value
							? "bg-foreground text-background"
							: "bg-surface-1 text-muted-foreground hover:text-foreground",
						disabled && "pointer-events-none opacity-60",
					)}
					disabled={disabled}
					key={option.value}
					onClick={() => onChange(option.value)}
					type="button"
				>
					{option.label}
				</button>
			))}
		</fieldset>
	);
}

const TEMPLATE_PLACEHOLDER = "blocked: {{ruleName}}\n\n{{runUrl}}";

export interface ResponseConfigFormProps {
	config: ResponseConfig;
	/** Admin-only edits — members see the config read-only. */
	canEdit: boolean;
	/** Commits (the save mutation). */
	onChange: (config: ResponseConfig) => void;
	/** Draft only — template keystrokes; commit follows on blur. */
	onDraft: (config: ResponseConfig) => void;
	/** Touching a verdict's controls focuses the preview on that verdict. */
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

	const section = (verdict: Verdict) => ({
		className: "flex flex-col gap-2",
		onClickCapture: () => onInteract(verdict),
		onFocusCapture: () => onInteract(verdict),
	});

	return (
		<div className="flex flex-col gap-6">
			<div {...section("pass")}>
				<p className={EYEBROW_CLASS}>on a pass</p>
				<PillGroup
					disabled={!canEdit}
					label="on a pass"
					onChange={(onSuccess) => patch({ onSuccess })}
					options={SUCCESS_OPTIONS}
					value={config.onSuccess}
				/>
			</div>

			<div {...section("block")}>
				<p className={EYEBROW_CLASS}>on a block</p>
				<PillGroup
					disabled={!canEdit}
					label="on a block"
					onChange={(onBlock) => patch({ onBlock })}
					options={COMMENT_OPTIONS}
					value={config.onBlock}
				/>
				<p className="text-muted-foreground text-xs">
					the check always blocks the merge. this only controls the comment.
				</p>
				{config.onBlock === "comment" ? (
					<div className="mt-2 flex flex-col gap-2">
						<p className={EYEBROW_CLASS}>comment shape</p>
						<PillGroup
							disabled={!canEdit}
							label="block comment shape"
							onChange={(mode) => patchBlockComment({ mode })}
							options={MODE_OPTIONS}
							value={config.blockComment.mode}
						/>
						{config.blockComment.mode === "one-liner-link" ? (
							<div className="mt-1 flex items-center justify-between gap-3 text-xs">
								<label htmlFor="response-show-rule-name">show rule names</label>
								<Switch
									checked={config.blockComment.showRuleName}
									disabled={!canEdit}
									id="response-show-rule-name"
									onCheckedChange={(checked) =>
										patchBlockComment({ showRuleName: checked })
									}
								/>
							</div>
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
			</div>

			<div {...section("needs_review")}>
				<p className={EYEBROW_CLASS}>sent to review</p>
				<PillGroup
					disabled={!canEdit}
					label="sent to review"
					onChange={(moderationQueued) => patch({ moderationQueued })}
					options={COMMENT_OPTIONS}
					value={config.moderationQueued}
				/>
			</div>
			{canEdit ? null : (
				<p className="text-muted-foreground text-xs">
					only org admins can change these settings.
				</p>
			)}
		</div>
	);
}
