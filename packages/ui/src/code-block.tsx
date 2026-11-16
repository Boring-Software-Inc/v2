import type { ComponentProps } from "react";
import { CopyButton } from "./copy-button";

export interface CodeBlockProps extends ComponentProps<"div"> {
	code: string;
	language?: string;
	showCopy?: boolean;
}

export function CodeBlock({
	code,
	language,
	showCopy = true,
	...props
}: CodeBlockProps) {
	return (
		<div data-language={language} data-slot="code-block" {...props}>
			{showCopy ? (
				<CopyButton size="small" text={code} variant="ghost" />
			) : null}
			<pre data-slot="code-block-pre">
				<code>{code}</code>
			</pre>
		</div>
	);
}
