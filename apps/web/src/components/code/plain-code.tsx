export interface PlainCodeProps {
	code: string;
}

export function PlainCode({ code }: PlainCodeProps) {
	const lines = code
		.replace(/\n$/, "")
		.split("\n")
		.map((text, index) => ({ text, number: index + 1 }));
	return (
		<pre
			className="overflow-x-auto bg-code-surface py-2 type-code-block text-text-1 [tab-size:2]"
			data-slot="plain-code"
		>
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
	);
}
