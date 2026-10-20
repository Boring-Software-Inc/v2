import type { ReactNode } from "react";
import { DocumentBlank, Icon } from "#/components/glaze/icon";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#/components/glaze/ui/collapsible";
import {
	Item,
	ItemContent,
	ItemGroup,
	ItemLink,
	ItemMedia,
	ItemMeta,
	ItemTitle,
} from "#/components/glaze/ui/item";
import { JsonView } from "#/components/glaze/ui/json-view";
import type { JsonValue } from "#/lib/runs.functions";

export function renderBackticks(text: string): ReactNode {
	return text.split(/(`[^`]+`)/g).map((part, i) => {
		if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
			return (
				<code
					className="mono rounded-tag bg-field px-1"
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
		<span className="mono truncate">
			<span className="text-text-3">{dir}</span>
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
		<ItemGroup
			aria-label="Protected files touched"
			className="mt-3"
			variant="plain"
		>
			{files.map((file) => {
				const url = blobUrl(repo, sha, file);
				return (
					<Item key={file} size="sm">
						<ItemMedia>
							<FileIcon />
						</ItemMedia>
						<ItemContent>
							<ItemTitle>
								{url ? (
									<ItemLink href={url} rel="noreferrer" target="_blank">
										<FilePath file={file} />
									</ItemLink>
								) : (
									<FilePath file={file} />
								)}
							</ItemTitle>
						</ItemContent>
					</Item>
				);
			})}
		</ItemGroup>
	);
}

export function CryptoMatches({
	matches,
}: {
	matches: { value: string; location: string }[];
}) {
	return (
		<ItemGroup aria-label="Matched addresses" className="mt-3" variant="plain">
			{matches.map((match, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: matches have no id; order is stable
				<Item key={i} size="sm">
					<ItemContent>
						<ItemTitle>
							<span className="type-code-sm">{match.value}</span>
						</ItemTitle>
					</ItemContent>
					<ItemMeta>in {match.location}</ItemMeta>
				</Item>
			))}
		</ItemGroup>
	);
}

export function RawDisclosure({ evidence }: { evidence: JsonValue }) {
	if (evidence === null || evidence === undefined) {
		return null;
	}
	return (
		<Collapsible className="mt-2 flex flex-col gap-1.5">
			<CollapsibleTrigger size="sm">Raw evidence</CollapsibleTrigger>
			<CollapsibleContent>
				<JsonView data={evidence} label="Raw evidence" />
			</CollapsibleContent>
		</Collapsible>
	);
}
