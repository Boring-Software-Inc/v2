import type {
	AiReviewOutput,
	Finding,
	FindingSeverity,
} from "@tripwire/contracts";
import { External, Icon } from "#/components/glaze/icon";
import { Badge } from "#/components/glaze/ui/badge";
import { Button } from "#/components/glaze/ui/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#/components/glaze/ui/collapsible";
import {
	blobUrl,
	FileIcon,
	FilePath,
	renderBackticks,
} from "#/components/runs/evidence-parts";

const SEVERITY: Record<
	FindingSeverity,
	{
		word: string;
		label: string;
		variant: "fail" | "warn" | "neutral";
		order: number;
	}
> = {
	critical: { word: "critical", label: "Critical", variant: "fail", order: 0 },
	warn: { word: "warning", label: "Warning", variant: "warn", order: 1 },
	info: { word: "note", label: "Note", variant: "neutral", order: 2 },
};

const COLLAPSE_AT = 3;

function severityCounts(findings: Finding[]): string {
	return (Object.keys(SEVERITY) as FindingSeverity[])
		.sort((a, b) => SEVERITY[a].order - SEVERITY[b].order)
		.map((s) => ({ s, n: findings.filter((f) => f.severity === s).length }))
		.filter((x) => x.n > 0)
		.map((x) => `${x.n} ${SEVERITY[x.s].word}`)
		.join(" · ");
}

function worstStatus(findings: Finding[]): "fail" | "warn" | undefined {
	if (findings.some((f) => f.severity === "critical")) {
		return "fail";
	}
	if (findings.some((f) => f.severity === "warn")) {
		return "warn";
	}
	return undefined;
}

function FindingRow({
	finding,
	repo,
	sha,
}: {
	finding: Finding;
	repo: string;
	sha: string | null;
}) {
	const sev = SEVERITY[finding.severity];
	const url = blobUrl(repo, sha, finding.file, finding.line);
	const inner = (
		<>
			<div className="flex items-center gap-2">
				<Badge size="sm" variant={sev.variant}>
					{sev.label}
				</Badge>
				{finding.line ? (
					<span className="type-caption text-text-2">Line {finding.line}</span>
				) : null}
			</div>
			<p className="mt-1 type-body-sm text-text-1">
				{renderBackticks(finding.note)}
			</p>
		</>
	);
	return (
		<li className="rule-row">
			{url ? (
				<a
					className="block rounded-tag px-2 py-2 hover:bg-hover-row"
					href={url}
					rel="noreferrer"
					target="_blank"
				>
					{inner}
				</a>
			) : (
				<div className="px-2 py-2">{inner}</div>
			)}
		</li>
	);
}

function FileFindings({
	file,
	findings,
	repo,
	sha,
}: {
	file: string;
	findings: Finding[];
	repo: string;
	sha: string | null;
}) {
	const fileUrl = blobUrl(repo, sha, file);
	return (
		<Collapsible
			className="flex flex-col gap-1"
			defaultOpen={findings.length < COLLAPSE_AT}
		>
			<div className="flex min-w-0 items-center gap-1">
				<CollapsibleTrigger
					size="sm"
					summary={severityCounts(findings)}
					summaryStatus={worstStatus(findings)}
				>
					<span className="flex min-w-0 items-center gap-1">
						<FileIcon />
						<FilePath file={file} />
					</span>
				</CollapsibleTrigger>
				{fileUrl ? (
					<Button
						nativeButton={false}
						aria-label={`Open ${file} on GitHub`}
						render={(props) => (
							<a {...props} href={fileUrl} rel="noreferrer" target="_blank" />
						)}
						size="icon-sm"
						variant="ghost"
					>
						<Icon icon={External} size={12} />
					</Button>
				) : null}
			</div>
			<CollapsibleContent>
				<ul className="flex flex-col ps-6">
					{findings.map((finding, i) => (
						<FindingRow
							finding={finding}
							// biome-ignore lint/suspicious/noArrayIndexKey: findings have no id; index is stable within a file
							key={i}
							repo={repo}
							sha={sha}
						/>
					))}
				</ul>
			</CollapsibleContent>
		</Collapsible>
	);
}

export function AiFindings({
	output,
	repo,
	sha,
}: {
	output: AiReviewOutput;
	repo: string;
	sha: string | null;
}) {
	if (output.findings.length === 0) {
		return null;
	}
	const byFile = new Map<string, Finding[]>();
	for (const finding of output.findings) {
		const bucket = byFile.get(finding.file);
		if (bucket) {
			bucket.push(finding);
		} else {
			byFile.set(finding.file, [finding]);
		}
	}
	return (
		<div className="mt-3 flex flex-col gap-2">
			{[...byFile.entries()].map(([file, findings]) => (
				<FileFindings
					file={file}
					findings={findings}
					key={file}
					repo={repo}
					sha={sha}
				/>
			))}
		</div>
	);
}
