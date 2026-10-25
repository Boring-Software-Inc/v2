import type { ResponseBlock, ResponseVariable } from "@tripwire/contracts";
import {
	RESPONSE_VARIABLES,
	TEXT_BLOCK_MAX,
	VARIABLE_HIDDEN_AT,
} from "@tripwire/contracts";
import { type ClipboardEvent, type KeyboardEvent, useRef } from "react";
import { Hide, Icon } from "#/components/glaze/icon";
import {
	INSERTABLE_VARIABLES,
	VARIABLE_LABELS,
} from "#/components/responses/blocks/block-catalog";
import {
	clampParts,
	nodesFromParts,
	partsFromNode,
} from "#/components/responses/blocks/text-parts";
import {
	VARIABLE_CHIP_CLASS,
	VariableChip,
} from "#/components/responses/blocks/variable-chip";

type TextBlock = Extract<ResponseBlock, { type: "text" }>;

const RULE_VARIABLES: ReadonlySet<ResponseVariable> = new Set(
	RESPONSE_VARIABLES.filter((name) => VARIABLE_HIDDEN_AT[name] !== undefined),
);

export interface TextBlockEditorProps {
	block: TextBlock;
	rulesHidden: boolean;
	onChange: (block: TextBlock) => void;
}

function endOf(el: HTMLElement): Range {
	const range = document.createRange();
	range.selectNodeContents(el);
	range.collapse(false);
	return range;
}

function rangeIn(el: HTMLElement): Range | null {
	const selection = window.getSelection();
	if (!selection || selection.rangeCount === 0) {
		return null;
	}
	const range = selection.getRangeAt(0);
	return el.contains(range.commonAncestorContainer) ? range.cloneRange() : null;
}

function placeCaret(range: Range) {
	const selection = window.getSelection();
	selection?.removeAllRanges();
	selection?.addRange(range);
}

function insertText(text: string) {
	document.execCommand("insertText", false, text);
}

export function TextBlockEditor({
	block,
	rulesHidden,
	onChange,
}: TextBlockEditorProps) {
	const editor = useRef<HTMLDivElement | null>(null);
	const icon = useRef<HTMLSpanElement>(null);
	const caret = useRef<Range | null>(null);

	const chip = (name: ResponseVariable) => {
		const el = document.createElement("span");
		el.dataset.var = name;
		el.contentEditable = "false";
		el.className = VARIABLE_CHIP_CLASS;
		const glyph = RULE_VARIABLES.has(name)
			? icon.current?.firstElementChild?.cloneNode(true)
			: null;
		if (glyph) {
			el.append(glyph);
		}
		el.append(VARIABLE_LABELS[name]);
		return el;
	};

	const emit = () => {
		if (editor.current) {
			onChange({
				...block,
				parts: clampParts(partsFromNode(editor.current), TEXT_BLOCK_MAX),
			});
		}
	};

	const mount = (el: HTMLDivElement | null) => {
		editor.current = el;
		if (el && !el.hasChildNodes()) {
			el.append(...nodesFromParts(block.parts, chip));
			el.focus();
			placeCaret(endOf(el));
		}
	};

	const remember = () => {
		const range = editor.current ? rangeIn(editor.current) : null;
		if (range) {
			caret.current = range;
		}
	};

	const insert = (name: ResponseVariable) => {
		const el = editor.current;
		if (!el) {
			return;
		}
		const range = rangeIn(el) ?? caret.current ?? endOf(el);
		const node = chip(name);
		range.deleteContents();
		range.insertNode(node);
		range.setStartAfter(node);
		range.collapse(true);
		el.focus();
		placeCaret(range);
		caret.current = range.cloneRange();
		emit();
	};

	const onKeyDown = (event: KeyboardEvent) => {
		if (event.key === "Enter") {
			event.preventDefault();
			insertText("\n");
		}
	};

	const onPaste = (event: ClipboardEvent) => {
		event.preventDefault();
		insertText(event.clipboardData.getData("text/plain"));
	};

	return (
		<div
			className="group/editor flex flex-col gap-2.5"
			data-rules-hidden={rulesHidden || undefined}
		>
			<span hidden ref={icon}>
				<Icon
					className="hidden text-text-3 group-data-rules-hidden/editor:block"
					icon={Hide}
					size={12}
				/>
			</span>
			{/* biome-ignore lint/a11y/useSemanticElements: a textarea cannot hold variable chips */}
			<div
				aria-label="Free text"
				aria-multiline
				className="min-h-5.25 whitespace-pre-wrap break-words type-body text-text-1 empty:before:text-text-3 empty:before:content-[attr(data-placeholder)] [&_[data-var]]:mx-0.5"
				contentEditable
				data-control=""
				data-placeholder="Write a message"
				onBlur={remember}
				onInput={emit}
				onKeyDown={onKeyDown}
				onKeyUp={remember}
				onMouseUp={remember}
				onPaste={onPaste}
				ref={mount}
				role="textbox"
				suppressContentEditableWarning
				tabIndex={0}
			/>
			<div className="flex flex-wrap items-center gap-1.5 border-line-faint border-t pt-2">
				<span className="pe-0.5 type-body-sm text-text-2">Insert</span>
				{INSERTABLE_VARIABLES.map((name) => (
					<VariableChip
						hidden={rulesHidden && RULE_VARIABLES.has(name)}
						key={name}
						name={name}
						onInsert={insert}
					/>
				))}
			</div>
		</div>
	);
}
