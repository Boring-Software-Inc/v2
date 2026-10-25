import { useEffect, useRef, useState } from "react";
import { Button } from "#/components/glaze/ui/button";
import {
	Field,
	FieldDescription,
	FieldLabel,
} from "#/components/glaze/ui/field";
import { Textarea } from "#/components/glaze/ui/textarea";
import { useDraftStore } from "#/components/responses/draft-store";
import type { DraftKey } from "#/components/responses/responses-model";

const COMMIT_DELAY_MS = 400;

const VARS: { token: string; label: string }[] = [
	{
		token: "{{ruleName}}",
		label: "Insert the blocking rule's one-line summary",
	},
	{ token: "{{runUrl}}", label: "Insert the View on Tripwire button" },
];

export interface MessageEditorProps {
	draftKey: DraftKey;
	initial: string;
	withVariables: boolean;
	disabled: boolean;
	onCommit: (key: DraftKey, value: string) => void;
}

export function MessageEditor({
	draftKey,
	initial,
	withVariables,
	disabled,
	onCommit,
}: MessageEditorProps) {
	const store = useDraftStore();
	const [text, setText] = useState(initial);
	const ref = useRef<HTMLTextAreaElement>(null);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const latest = useRef(text);
	const commitRef = useRef(onCommit);
	commitRef.current = onCommit;

	const flush = () => {
		if (timer.current) {
			clearTimeout(timer.current);
			timer.current = null;
		}
		commitRef.current(draftKey, latest.current);
	};

	const update = (next: string) => {
		setText(next);
		latest.current = next;
		store.set(draftKey, next);
		if (timer.current) {
			clearTimeout(timer.current);
		}
		timer.current = setTimeout(flush, COMMIT_DELAY_MS);
	};

	useEffect(
		() => () => {
			if (timer.current) {
				clearTimeout(timer.current);
				commitRef.current(draftKey, latest.current);
			}
			store.clear(draftKey);
		},
		[draftKey, store],
	);

	const insert = (token: string) => {
		const el = ref.current;
		const start = el?.selectionStart ?? text.length;
		const end = el?.selectionEnd ?? start;
		update(text.slice(0, start) + token + text.slice(end));
		requestAnimationFrame(() => {
			if (el) {
				el.focus();
				const caret = start + token.length;
				el.setSelectionRange(caret, caret);
			}
		});
	};

	return (
		<div className="flex flex-col gap-2" data-feedback-name="MessageEditor">
			<Field disabled={disabled}>
				<FieldLabel>Message</FieldLabel>
				<Textarea
					autoGrow
					maxRows={8}
					minRows={3}
					onBlur={flush}
					onChange={(event) => update(event.target.value)}
					placeholder={
						withVariables
							? "Blocked: {{ruleName}}"
							: "Thanks for the change request."
					}
					ref={ref}
					value={text}
				/>
				<FieldDescription>
					{withVariables
						? "Replaces the whole comment. Insert a variable to fill in the run's details."
						: "Replaces the whole comment for this verdict."}
				</FieldDescription>
			</Field>
			{withVariables ? (
				<div className="flex flex-wrap gap-2">
					{VARS.map((v) => (
						<Button
							aria-label={v.label}
							disabled={disabled}
							key={v.token}
							onClick={() => insert(v.token)}
							size="sm"
							variant="secondary"
						>
							<span className="mono">{v.token}</span>
						</Button>
					))}
				</div>
			) : null}
		</div>
	);
}
