import { type CSSProperties, useRef } from "react";
import { DocumentBlank, Icon } from "#/components/glaze/icon";
import { Badge } from "#/components/glaze/ui/badge";
import { Card } from "#/components/glaze/ui/card";
import { TokenLine, tokenize } from "#/components/glaze/ui/code-block";
import { CopyButton } from "#/components/glaze/ui/copy-button";
import { useScrollTabStop } from "#/lib/glaze/data";
import type { WorkflowCodeView } from "#/lib/workflow-code-view";

const FILE_NAME = "tripwire.ts";

export interface WorkflowCodeProps {
	view: WorkflowCodeView;
	unsaved: boolean;
}

export function WorkflowCode({ view, unsaved }: WorkflowCodeProps) {
	return (
		<div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
			<div className="mx-auto w-full max-w-190 px-3 pt-6 pb-8 sm:px-6">
				<Card>
					<div className="flex h-10 min-w-0 items-center gap-2 border-line-faint border-b ps-3.5 pe-1.5">
						<Icon className="text-text-2" icon={DocumentBlank} />
						<span className="min-w-0 truncate type-code-block text-text-1">
							{FILE_NAME}
						</span>
						{view.kind === "code" && unsaved ? (
							<Badge variant="outline">Unsaved</Badge>
						) : null}
						{view.kind === "code" ? (
							<CopyButton
								className="ms-auto"
								label={FILE_NAME}
								showLabel
								value={view.code}
								variant="secondary"
							/>
						) : null}
					</div>
					{view.kind === "code" ? (
						<>
							{view.warnings.length > 0 ? (
								<ul className="flex flex-col gap-1 border-line-faint border-b px-4 py-2 type-body-sm text-text-2">
									{view.warnings.map((warning) => (
										<li key={warning}>{warning}</li>
									))}
								</ul>
							) : null}
							<CodeLines code={view.code} />
						</>
					) : (
						<div className="flex flex-col gap-1 p-4">
							<p className="type-label text-text-1">
								This workflow cannot be written as code
							</p>
							<p className="type-body-sm text-text-2">{view.reason}</p>
						</div>
					)}
				</Card>
			</div>
		</div>
	);
}

function CodeLines({ code }: { code: string }) {
	const lines = tokenize(code.replace(/\n$/, ""), "ts").map(
		(tokens, index) => ({ tokens, number: index + 1 }),
	);
	const gutter = {
		"--gutter": `calc(${String(lines.length).length}ch + var(--space-8))`,
	} as CSSProperties;
	const scroller = useRef<HTMLElement>(null);
	const tabStop = useScrollTabStop(scroller);
	return (
		<section
			aria-label={FILE_NAME}
			ref={scroller}
			className="overflow-x-auto py-3 type-code-block [tab-size:2] focus-visible:focus-ring-inset"
			dir="ltr"
			tabIndex={tabStop}
		>
			<pre className="w-max min-w-full">
				<code className="block">
					{lines.map((line) => (
						<span className="flex pe-4" key={line.number}>
							<span
								aria-hidden
								className="sticky start-0 w-(--gutter) shrink-0 bg-paper ps-4 pe-4 text-end text-text-3 select-none"
								style={gutter}
							>
								{line.number}
							</span>
							<span className="whitespace-pre">
								<TokenLine tokens={line.tokens} />
							</span>
						</span>
					))}
				</code>
			</pre>
		</section>
	);
}
