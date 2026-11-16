import { type ReactNode, useEffect, useRef, useState } from "react";
import {
	Button,
	type ButtonSize,
	type ButtonVariant,
	IconButton,
} from "./button";
import { Check, Copy, Icon, Warning } from "./icon";

type CopyValue = string | (() => string | Promise<string>);
type CopyState = "idle" | "fetching" | "copied" | "failed";

async function writeFetched(result: Promise<string>): Promise<string> {
	let text = "";
	const blob = result.then((resolved) => {
		text = resolved;
		return new Blob([resolved], { type: "text/plain" });
	});
	if (globalThis.ClipboardItem && navigator.clipboard?.write) {
		try {
			await navigator.clipboard.write([
				new ClipboardItem({ "text/plain": blob }),
			]);
			return text;
		} catch {
			text = await result;
		}
	} else {
		text = await result;
	}
	await navigator.clipboard.writeText(text);
	return text;
}

export interface CopyButtonProps {
	ariaLabel?: string;
	copyLabel?: string;
	copiedLabel?: string;
	disabled?: boolean;
	icon?: ReactNode;
	label?: string;
	onCopy?: (value: string) => void;
	showLabel?: boolean;
	size?: ButtonSize;
	text?: string;
	timeout?: number;
	value?: CopyValue;
	variant?: Exclude<ButtonVariant, "destructive">;
}

export function CopyButton({
	ariaLabel,
	copyLabel = "Copy",
	copiedLabel = "Copied",
	icon,
	label,
	onCopy,
	showLabel = true,
	text,
	timeout = 1600,
	value,
	...props
}: CopyButtonProps) {
	const [state, setState] = useState<CopyState>("idle");
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	useEffect(() => () => clearTimeout(timer.current), []);

	const accessibleLabel = ariaLabel ?? (label ? `Copy ${label}` : copyLabel);
	const visibleLabel =
		state === "copied"
			? copiedLabel
			: state === "failed"
				? "Copy failed"
				: copyLabel;
	const source = value ?? text ?? "";

	const glyph =
		state === "copied" ? Check : state === "failed" ? Warning : Copy;
	const control = {
		...props,
		disabled: state === "fetching" || props.disabled,
		onAction: async () => {
			clearTimeout(timer.current);
			try {
				const result = source instanceof Function ? source() : source;
				let copied: string;
				if (result instanceof Promise) {
					setState("fetching");
					copied = await writeFetched(result);
				} else {
					copied = result;
					await navigator.clipboard.writeText(copied);
				}
				onCopy?.(copied);
				setState("copied");
			} catch {
				setState("failed");
			}
			timer.current = setTimeout(() => setState("idle"), timeout);
		},
	};

	return (
		<>
			{showLabel ? (
				<Button {...control} ariaLabel={accessibleLabel} leadingIcon={icon}>
					{visibleLabel}
				</Button>
			) : (
				<IconButton
					{...control}
					icon={
						glyph === Copy ? (
							(icon ?? <Icon icon={Copy} />)
						) : (
							<Icon icon={glyph} />
						)
					}
					label={accessibleLabel}
				/>
			)}
			<span aria-live="polite" className="ui-sr-only">
				{state === "copied"
					? label
						? `${label} copied`
						: copiedLabel
					: state === "failed"
						? "Could not copy. Select the text and copy it manually."
						: ""}
			</span>
		</>
	);
}
