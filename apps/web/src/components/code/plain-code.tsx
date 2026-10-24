import type { ReactNode } from "react";

export interface PlainCodeProps {
	name: string;
	code: string;
	header: ReactNode;
}

export function PlainCode({ name, code, header }: PlainCodeProps) {
	const lines = code
		.replace(/\n$/, "")
		.split("\n")
		.map((text, index) => ({ text, number: index + 1 }));
	return (
		<div className="bg-code-surface" data-slot="plain-code">
			<div className="flex h-10 min-w-0 items-center gap-2 ps-4 pe-1.5">
				<span className="min-w-0 truncate type-label text-text-1">{name}</span>
				<div className="ms-auto flex shrink-0 items-center gap-1">{header}</div>
			</div>
			<pre className="overflow-x-auto py-2 type-code-block text-text-1 [tab-size:2]">
				{lines.map((line) => (
					<span className="flex" key={line.number}>
						<span
							aria-hidden
							className="w-12 shrink-0 pe-4 text-end text-text-3 select-none"
						>
							{line.number}
						</span>
						<span className="whitespace-pre">{line.text}</span>
					</span>
				))}
			</pre>
		</div>
	);
}
