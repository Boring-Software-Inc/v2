import { useRef } from "react";

/**
 * The custom block-comment template editor, revealed in the config column when
 * the block comment's shape is `custom`. Editing here focuses the preview on
 * the blocked verdict, so the raw template (left) and the rendered end result
 * (right) stay co-visible, live per keystroke. The var chips insert at the
 * caret so nobody hand-types `{{ruleName}}`.
 */

const VARS: { token: string; label: string }[] = [
	{ token: "{{ruleName}}", label: "rule one-liner" },
	{ token: "{{runUrl}}", label: "view on tripwire button" },
];

export interface TemplateEditorProps {
	value: string;
	/** Every keystroke — updates the draft so the mock above re-renders live. */
	onDraft: (value: string) => void;
	/** Blur — commits the draft (the save mutation). */
	onCommit: () => void;
	placeholder: string;
	disabled: boolean;
}

export function TemplateEditor({
	value,
	onDraft,
	onCommit,
	placeholder,
	disabled,
}: TemplateEditorProps) {
	const ref = useRef<HTMLTextAreaElement>(null);

	const insert = (token: string) => {
		const el = ref.current;
		const start = el?.selectionStart ?? value.length;
		const end = el?.selectionEnd ?? start;
		onDraft(value.slice(0, start) + token + value.slice(end));
		requestAnimationFrame(() => {
			if (el) {
				el.focus();
				const caret = start + token.length;
				el.setSelectionRange(caret, caret);
			}
		});
	};

	return (
		<div className="flex flex-col gap-2 rounded-xl bg-surface-1 px-3.5 py-3">
			<div className="flex items-center justify-between gap-3">
				<p className="font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
					template
				</p>
				<div className="flex gap-1.5">
					{VARS.map((v) => (
						<button
							className="rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-60"
							disabled={disabled}
							key={v.token}
							onClick={() => insert(v.token)}
							title={v.label}
							type="button"
						>
							{v.token}
						</button>
					))}
				</div>
			</div>
			<textarea
				aria-label="block comment template"
				className="min-h-20 w-full resize-y rounded-md bg-transparent font-mono text-xs leading-5 placeholder:text-muted-foreground/60 focus:outline-none disabled:opacity-60"
				disabled={disabled}
				onBlur={onCommit}
				onChange={(event) => onDraft(event.target.value)}
				placeholder={placeholder}
				ref={ref}
				value={value}
			/>
			<p className="text-[11px] text-muted-foreground">
				{"{{ruleName}}"} is the failing rule's one-liner. {"{{runUrl}}"} becomes
				the view on tripwire button. the preview renders the result live.
			</p>
		</div>
	);
}
