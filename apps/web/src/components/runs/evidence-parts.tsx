import type { ReactNode } from "react";
import { DocumentBlank, Icon } from "#/components/glaze/icon";

export function renderBackticks(text: string): ReactNode {
	return text.split(/(`[^`]+`)/g).map((part, i) => {
		if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
			return (
				<code
					className="text-text-1"
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

export function FileIcon() {
	return (
		<Icon className="shrink-0 text-text-3" icon={DocumentBlank} size={14} />
	);
}

export function FilePath({ file }: { file: string }) {
	const cut = file.lastIndexOf("/");
	const dir = cut >= 0 ? file.slice(0, cut + 1) : "";
	const base = cut >= 0 ? file.slice(cut + 1) : file;
	return (
		<span className="mono [overflow-wrap:anywhere]">
			<span className="text-text-2">{dir}</span>
			<span className="text-text-1">{base}</span>
		</span>
	);
}

export function blobUrl(
	repo: string,
	sha: string | null,
	file: string,
	line?: number,
): string | null {
	if (!sha) {
		return null;
	}
	return `https://github.com/${repo}/blob/${sha}/${file}${line ? `#L${line}` : ""}`;
}

export function FileRows({
	repo,
	sha,
	files,
}: {
	repo: string;
	sha: string | null;
	files: string[];
}) {
	return (
		<ul
			aria-label="Protected files touched"
			className="flex flex-col rounded-panel well"
		>
			{files.map((file) => {
				const url = blobUrl(repo, sha, file);
				return (
					<li
						className="rule-row flex min-w-0 items-center gap-1.5 px-3 py-2 type-code-sm"
						key={file}
					>
						<FileIcon />
						{url ? (
							<a
								className="min-w-0 hover:underline"
								href={url}
								rel="noreferrer"
								target="_blank"
							>
								<FilePath file={file} />
							</a>
						) : (
							<FilePath file={file} />
						)}
					</li>
				);
			})}
		</ul>
	);
}

export function CryptoMatches({
	matches,
}: {
	matches: { value: string; location: string }[];
}) {
	return (
		<ul
			aria-label="Matched addresses"
			className="flex flex-col rounded-panel well"
		>
			{matches.map((match, i) => (
				<li
					className="rule-row flex flex-col gap-1 px-3 py-2"
					// biome-ignore lint/suspicious/noArrayIndexKey: matches have no id; order is fixed
					key={i}
				>
					<span className="type-code-sm text-text-1 [overflow-wrap:anywhere]">
						{match.value}
					</span>
					<span className="type-caption text-text-2">
						in <span className="mono">{match.location}</span>
					</span>
				</li>
			))}
		</ul>
	);
}
