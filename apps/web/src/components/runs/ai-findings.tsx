import type {
	AiReviewOutput,
	Finding,
	FindingSeverity,
} from "@tripwire/contracts";
import {
	blobUrl,
	FileIcon,
	FilePath,
	renderBackticks,
} from "#/components/runs/evidence-parts";
import { External, Icon } from "#/design-system/icon";
import {
	Caption,
	CodeText,
	Label,
	SupportingText,
} from "#/design-system/ui/typography";

const SEVERITY = {
	critical: "Critical",
	warn: "Warning",
	info: "Note",
} satisfies Record<FindingSeverity, string>;

function FindingRow({
	finding,
	repo,
	sha,
}: {
	finding: Finding;
	repo: string;
	sha: string | null;
}) {
	const url = finding.line
		? blobUrl(repo, sha, finding.file, finding.line)
		: null;
	return (
		<li className="rounded-tag" data-layout-role="ai-finding">
			<div data-layout-role="ai-finding-heading">
				<Label
					data-layout-role="ai-finding-severity"
					data-severity={finding.severity}
				>
					{SEVERITY[finding.severity]}
				</Label>
				{finding.line ? (
					url ? (
						<Caption>
							<a
								data-layout-role="ai-finding-line"
								href={url}
								rel="noreferrer"
								target="_blank"
							>
								Line {finding.line}
							</a>
						</Caption>
					) : (
						<Caption data-layout-role="ai-finding-line">
							Line {finding.line}
						</Caption>
					)
				) : null}
			</div>
			<SupportingText data-layout-role="ai-finding-note">
				{renderBackticks(finding.note)}
			</SupportingText>
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
		<div data-layout-role="ai-findings">
			{[...byFile.entries()].map(([file, findings]) => {
				const fileUrl = blobUrl(repo, sha, file);
				return (
					<div
						className="rounded-panel well"
						data-layout-role="ai-findings-file"
						key={file}
					>
						<CodeText as="span" data-layout-role="ai-findings-file-heading">
							<FileIcon />
							{fileUrl ? (
								<a
									className="hover:underline"
									data-layout-role="ai-findings-file-link"
									href={fileUrl}
									rel="noreferrer"
									target="_blank"
								>
									<FilePath file={file} />
									<Icon
										data-layout-role="ai-findings-external"
										icon={External}
										size={12}
									/>
								</a>
							) : (
								<FilePath file={file} />
							)}
						</CodeText>
						<ul data-layout-role="ai-findings-list">
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
