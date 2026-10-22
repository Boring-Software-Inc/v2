import type {
	AiReviewOutput,
	Finding,
	FindingSeverity,
} from "@tripwire/contracts";
import { External, Icon } from "#/components/glaze/icon";
import {
	blobUrl,
	FileIcon,
	FilePath,
	renderBackticks,
} from "#/components/runs/evidence-parts";
import { cn } from "#/lib/utils";

const SEVERITY = {
	critical: { label: "Critical", tone: "text-fail-text" },
	warn: { label: "Warning", tone: "text-text-1" },
	info: { label: "Note", tone: "text-text-2" },
} satisfies Record<FindingSeverity, { label: string; tone: string }>;

function FindingRow({
	finding,
	repo,
	sha,
}: {
	finding: Finding;
	repo: string;
	sha: string | null;
}) {
	const severity = SEVERITY[finding.severity];
	const url = finding.line
		? blobUrl(repo, sha, finding.file, finding.line)
		: null;
	return (
		<li className="flex flex-col gap-1 rounded-tag bg-paper px-2 py-2">
			<div className="flex items-baseline gap-2">
				<span className={cn("type-label-sm", severity.tone)}>
					{severity.label}
				</span>
				{finding.line ? (
					url ? (
						<a
							className="type-caption text-text-2 hover:text-text-1 hover:underline"
							href={url}
							rel="noreferrer"
							target="_blank"
						>
							Line {finding.line}
						</a>
					) : (
						<span className="type-caption text-text-2">
							Line {finding.line}
						</span>
					)
				) : null}
			</div>
			<p className="type-body-sm text-text-1 [overflow-wrap:anywhere]">
				{renderBackticks(finding.note)}
			</p>
		</li>
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
		byFile.set(finding.file, [...(byFile.get(finding.file) ?? []), finding]);
	}
	return (
		<div className="flex flex-col gap-2">
			{[...byFile.entries()].map(([file, findings]) => {
				const fileUrl = blobUrl(repo, sha, file);
				return (
					<div
						className="flex flex-col gap-1 rounded-panel well p-1"
						key={file}
					>
						<div className="flex min-w-0 items-center gap-1.5 px-2 py-1.5 type-code-sm">
							<FileIcon />
							{fileUrl ? (
								<a
									className="flex min-w-0 items-center gap-1 hover:underline"
									href={fileUrl}
									rel="noreferrer"
									target="_blank"
								>
									<FilePath file={file} />
									<Icon className="text-text-3" icon={External} size={12} />
								</a>
							) : (
								<FilePath file={file} />
							)}
						</div>
						<ul className="flex flex-col gap-1">
							{findings.map((finding, i) => (
								<FindingRow
									finding={finding}
									// biome-ignore lint/suspicious/noArrayIndexKey: findings have no id; order is fixed within a file
									key={i}
									repo={repo}
									sha={sha}
								/>
							))}
						</ul>
					</div>
				);
			})}
		</div>
	);
}
