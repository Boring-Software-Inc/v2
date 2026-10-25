import { useId, useState } from "react";
import { Button } from "#/components/glaze/ui/button";
import { Textarea } from "#/components/glaze/ui/textarea";

export interface CommentEditorProps {
	initial: string;
	placeholder: string;
	onCancel: () => void;
	onSave: (text: string) => void;
}

export function CommentEditor({
	initial,
	placeholder,
	onCancel,
	onSave,
}: CommentEditorProps) {
	const [text, setText] = useState(initial);
	const id = useId();
	const custom = initial.trim() !== "";
	return (
		<form
			className="flex flex-col gap-2 p-2"
			data-region="comment-body"
			onSubmit={(event) => {
				event.preventDefault();
				onSave(text.trim());
			}}
		>
			<label className="sr-only" htmlFor={id}>
				Comment text
			</label>
			<Textarea
				autoFocus
				autoGrow
				id={id}
				maxLength={4000}
				maxRows={10}
				minRows={3}
				onChange={(event) => setText(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Escape") {
						event.preventDefault();
						onCancel();
					}
					if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
						event.preventDefault();
						onSave(text.trim());
					}
				}}
				placeholder={placeholder}
				value={text}
			/>
			<div className="flex flex-wrap items-center justify-end gap-2">
				{custom ? (
					<Button
						className="me-auto"
						onClick={() => onSave("")}
						size="sm"
						type="button"
						variant="ghost"
					>
						Use the default
					</Button>
				) : null}
				<Button onClick={onCancel} size="sm" type="button" variant="secondary">
					Cancel
				</Button>
				<Button size="sm" type="submit">
					Save
				</Button>
			</div>
		</form>
	);
}
