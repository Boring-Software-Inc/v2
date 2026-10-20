import { useRef } from "react";
import { Button } from "#/components/glaze/ui/button";
import {
	Field,
	FieldDescription,
	FieldLabel,
} from "#/components/glaze/ui/field";
import { Textarea } from "#/components/glaze/ui/textarea";

const VARS: { token: string; label: string }[] = [
	{ token: "{{ruleName}}", label: "rule one-liner" },
	{ token: "{{runUrl}}", label: "view on tripwire button" },
];

export interface TemplateEditorProps {
	value: string;
	onDraft: (value: string) => void;
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
		<div className="flex flex-col gap-2">
			<Field disabled={disabled}>
				<FieldLabel>Template</FieldLabel>
				<Textarea
					onBlur={onCommit}
					onChange={(event) => onDraft(event.target.value)}
					placeholder={placeholder}
					ref={ref}
					resizable
					rows={4}
					value={value}
				/>
				<FieldDescription>
					{"{{ruleName}}"} is the failing rule's one-liner. {"{{runUrl}}"}{" "}
					becomes the view on tripwire button. The preview renders the result
					live.
				</FieldDescription>
			</Field>
			<div className="flex flex-wrap gap-2">
				{VARS.map((v) => (
					<Button
						disabled={disabled}
						key={v.token}
						onClick={() => insert(v.token)}
						size="sm"
						title={v.label}
						variant="secondary"
					>
						<span className="mono">{v.token}</span>
					</Button>
				))}
			</div>
		</div>
	);
}
