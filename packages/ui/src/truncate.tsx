import type { ComponentProps } from "react";

export interface TruncateProps extends ComponentProps<"span"> {
	lines?: 1 | 2 | 3;
}

export function Truncate({ lines = 1, style, ...props }: TruncateProps) {
	return (
		<span
			data-lines={lines}
			data-slot="truncate"
			style={{ ...style, WebkitLineClamp: lines }}
			{...props}
		/>
	);
}

export interface TextHintProps extends ComponentProps<"span"> {
	hint: string;
}

export function TextHint({ children, hint, ...props }: TextHintProps) {
	return (
		<span data-slot="text-hint" title={hint} {...props}>
			{children}
		</span>
	);
}

export function splitTail(value: string, length = 8) {
	if (value.length <= length) return [value, ""] as const;
	return [value.slice(0, -length), value.slice(-length)] as const;
}
