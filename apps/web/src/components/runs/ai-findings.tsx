import { ArrowDown01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type {
	AiReviewOutput,
	Finding,
	FindingSeverity,
} from "@tripwire/contracts";
import { type ReactNode, useState } from "react";
import { cn } from "#/lib/utils";

/**
 * §8 ai-review findings — file containers with severity-tinted finding cards.
 * Findings render on the run page (and the public view), never in the PR
 * comment, never the raw trace. A finding is always a negative observation: it
 * carries a severity, not a pass/fail.
 */

const SEVERITY: Record<
	FindingSeverity,
	{ word: string; wordClass: string; tint: string; order: number }
> = {
	critical: {
		word: "critical",
		wordClass: "text-red-600 dark:text-red-400",
		// surface-1 + ~7% destructive, so no two severities share a surface.
		tint: "color-mix(in srgb, var(--surface-1) 93%, var(--destructive) 7%)",
		order: 0,
	},
	warn: {
		word: "warning",
		wordClass: "text-amber-600 dark:text-amber-400",
		tint: "color-mix(in srgb, var(--surface-1) 94%, #f59e0b 6%)",
		order: 1,
	},
	info: {
		word: "note",
		wordClass: "text-muted-foreground",
		tint: "var(--surface-1)",
		order: 2,
	},
};

const COLLAPSE_AT = 3;

/** Inline `code` in a reason → mono chips. Sanitized: rendered as text, not HTML. */
function renderBackticks(text: string): ReactNode {
	return text.split(/(`[^`]+`)/g).map((part, i) => {
		if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
			return (
				<code
					className="rounded bg-surface-2 px-1 py-px font-mono text-[11.5px]"
					// biome-ignore lint/suspicious/noArrayIndexKey: static split, stable order
					key={i}
				>
					{part.slice(1, -1)}
				</code>
			);
		}
		return part;
	});
}

function FileIcon() {
	return (
		<svg
			className="shrink-0 text-muted-foreground/55"
			fill="none"
			height="13"
			role="img"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth="1.7"
			viewBox="0 0 24 24"
			width="13"
		>
			<title>file</title>
			<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
			<polyline points="14 2 14 8 20 8" />
		</svg>
	);
}

/** Path with a dim directory and a bright basename — that's what reads as a file. */
function FilePath({ file }: { file: string }) {
	const cut = file.lastIndexOf("/");
	const dir = cut >= 0 ? file.slice(0, cut + 1) : "";
	const base = cut >= 0 ? file.slice(cut + 1) : file;
	return (
		<span className="truncate font-mono text-[12px]/4">
			<span className="text-muted-foreground/55">{dir}</span>
			<span className="font-medium text-foreground">{base}</span>
		</span>
	);
}

function severityCounts(findings: Finding[]): string {
	return (Object.keys(SEVERITY) as FindingSeverity[])
		.sort((a, b) => SEVERITY[a].order - SEVERITY[b].order)
		.map((s) => ({ s, n: findings.filter((f) => f.severity === s).length }))
		.filter((x) => x.n > 0)
		.map((x) => `${x.n} ${SEVERITY[x.s].word}`)
		.join(" · ");
}

function blobUrl(
	repo: string,
	sha: string | null,
	file: string,
	line?: number,
) {
	if (!sha) {
		return null;
	}
	return `https://github.com/${repo}/blob/${sha}/${file}${line ? `#L${line}` : ""}`;
}

function FindingCard({
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
		<div className="rounded-md px-3 py-2" style={{ backgroundColor: sev.tint }}>
			<div className="flex items-center gap-2">
				<span className={cn("font-medium text-[11px]/4", sev.wordClass)}>
					{sev.word}
				</span>
				{finding.line ? (
					<span className="text-[11px]/4 text-muted-foreground">
						line {finding.line}
					</span>
				) : null}
			</div>
			<p className="mt-1 text-[13px]/5 text-foreground">
				{renderBackticks(finding.note)}
			</p>
		</div>
	);
	return url ? (
		<a className="block" href={url} rel="noreferrer" target="_blank">
			{inner}
		</a>
	) : (
		inner
	);
}

function FileContainer({
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
	const collapsible = findings.length >= COLLAPSE_AT;
	const [open, setOpen] = useState(!collapsible);
	const fileUrl = blobUrl(repo, sha, file);

	return (
		<div className="rounded-xl bg-surface-1 p-1">
			<div className="flex items-center gap-2 px-2 py-2">
				{collapsible ? (
					<button
						aria-label={open ? "collapse" : "expand"}
						className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
						onClick={() => setOpen((v) => !v)}
						type="button"
					>
						<HugeiconsIcon
							icon={open ? ArrowDown01Icon : ArrowRight01Icon}
							size={14}
							strokeWidth={2}
						/>
					</button>
				) : null}
				<FileLink url={fileUrl}>
					<FileIcon />
					<FilePath file={file} />
				</FileLink>
				<span className="shrink-0 text-[11px]/4 text-muted-foreground">
					{severityCounts(findings)}
				</span>
			</div>
			{open ? (
				<div className="flex flex-col gap-1 px-1 pb-1">
					{findings.map((finding, i) => (
						<FindingCard
							finding={finding}
							// biome-ignore lint/suspicious/noArrayIndexKey: findings have no id; index is stable within a file
							key={i}
							repo={repo}
							sha={sha}
						/>
					))}
				</div>
			) : null}
		</div>
	);
}

function FileLink({
	url,
	children,
}: {
	url: string | null;
	children: ReactNode;
}) {
	const className = "flex min-w-0 flex-1 items-center gap-2";
	return url ? (
		<a className={className} href={url} rel="noreferrer" target="_blank">
			{children}
		</a>
	) : (
		<div className={className}>{children}</div>
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
	// Group by file, first-seen order.
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
				<FileContainer
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
