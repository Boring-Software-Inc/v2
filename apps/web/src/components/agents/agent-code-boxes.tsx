import { type ReactNode, useRef } from "react";
import {
	CODE_LENGTH,
	type CodeEdit,
	codeHalves,
	eraseAt,
	fillFrom,
	formatCode,
	typeAt,
} from "#/components/agents/device-code";
import { cn } from "#/lib/glaze/utils";

const BOX =
	"flex h-12 w-9 min-w-0 shrink items-center justify-center rounded-tag border border-line bg-shell font-medium font-mono text-[22px] text-text-1 leading-7";

function CodeRow({ left, right }: { left: ReactNode; right: ReactNode }) {
	return (
		<div className="flex h-16 items-center justify-center gap-1.5">
			{left}
			<span
				aria-hidden
				className="h-0.5 w-2.5 shrink-0 rounded-pill bg-line-focus"
			/>
			{right}
		</div>
	);
}

export function CodeBoxes({ code }: { code: string }) {
	const [left, right] = codeHalves(code);
	const box = (char: string, index: number) => (
		<span className={BOX} key={`${index}-${char}`}>
			{char}
		</span>
	);
	return (
		<div aria-label={formatCode(code)} role="img">
			<CodeRow
				left={left.map((char, index) => box(char, index))}
				right={right.map((char, index) => box(char, left.length + index))}
			/>
		</div>
	);
}

const SLOTS = Array.from({ length: CODE_LENGTH }, (_, index) => index);

export function CodeInput({
	cells,
	onChange,
}: {
	cells: string[];
	onChange: (cells: string[]) => void;
}) {
	const inputs = useRef<(HTMLInputElement | null)[]>([]);

	const apply = (edit: CodeEdit) => {
		onChange(edit.cells);
		const next = inputs.current[edit.focus];
		next?.focus();
		next?.select();
	};

	const input = (index: number) => (
		<input
			aria-label={`Character ${index + 1} of ${CODE_LENGTH}`}
			autoCapitalize="characters"
			autoComplete={index === 0 ? "one-time-code" : "off"}
			autoCorrect="off"
			className={cn(
				BOX,
				"text-center caret-text-1 outline-none! transition-colors duration-(--dur-state) ease-out focus:border-text-2",
			)}
			key={index}
			onChange={(event) => apply(typeAt(cells, index, event.target.value))}
			onFocus={(event) => event.target.select()}
			onKeyDown={(event) => {
				if (event.key === "Backspace") {
					event.preventDefault();
					apply(eraseAt(cells, index));
				} else if (event.key === "ArrowLeft" && index > 0) {
					event.preventDefault();
					inputs.current[index - 1]?.focus();
				} else if (event.key === "ArrowRight" && index < CODE_LENGTH - 1) {
					event.preventDefault();
					inputs.current[index + 1]?.focus();
				}
			}}
			onPaste={(event) => {
				event.preventDefault();
				apply(fillFrom(cells, index, event.clipboardData.getData("text")));
			}}
			ref={(node) => {
				inputs.current[index] = node;
			}}
			spellCheck={false}
			value={cells[index] ?? ""}
		/>
	);

	return (
		<fieldset aria-label="Code">
			<CodeRow
				left={SLOTS.slice(0, CODE_LENGTH / 2).map(input)}
				right={SLOTS.slice(CODE_LENGTH / 2).map(input)}
			/>
		</fieldset>
	);
}
