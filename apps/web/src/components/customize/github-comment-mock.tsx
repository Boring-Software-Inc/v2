import { COMMENT_MARKER } from "@tripwire/contracts";
import type { ReactNode } from "react";
import { Avatar, AvatarFallback } from "#/components/glaze/ui/avatar";
import { Badge } from "#/components/glaze/ui/badge";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "#/components/glaze/ui/empty-state";
import { GithubIcon } from "#/components/icons/github";

type BodyBlock =
	| { kind: "paragraph"; text: string }
	| { kind: "details"; summary: string; body: string }
	| { kind: "button"; href: string; src: string; alt: string };

const DETAILS_RE =
	/<details><summary>(.*?)<\/summary>\n\n([\s\S]*?)\n<\/details>/;
const BUTTON_RE =
	/<a href="([^"]*)"><img src="([^"]*)"[^>]*alt="([^"]*)" \/><\/a>/;

function parseBody(body: string): BodyBlock[] {
	const blocks: BodyBlock[] = [];
	let rest = body.replaceAll(COMMENT_MARKER, "").trim();
	while (rest.length > 0) {
		const details = DETAILS_RE.exec(rest);
		const button = BUTTON_RE.exec(rest);
		const next = [details, button]
			.filter((m): m is RegExpExecArray => m !== null)
			.sort((a, b) => a.index - b.index)[0];
		const plain = next ? rest.slice(0, next.index) : rest;
		for (const paragraph of plain.split(/\n{2,}/)) {
			if (paragraph.trim()) {
				blocks.push({ kind: "paragraph", text: paragraph.trim() });
			}
		}
		if (!next) {
			break;
		}
		if (next === details && details) {
			blocks.push({
				kind: "details",
				summary: details[1] ?? "",
				body: details[2] ?? "",
			});
		} else if (button) {
			blocks.push({
				kind: "button",
				href: button[1] ?? "",
				src: button[2] ?? "",
				alt: button[3] ?? "",
			});
		}
		rest = rest.slice(next.index + next[0].length).trim();
	}
	return blocks;
}

function renderInline(text: string): ReactNode {
	return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
		if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
			return (
				// biome-ignore lint/suspicious/noArrayIndexKey: static parse of a string
				<strong key={i}>{renderBackticks(part.slice(2, -2))}</strong>
			);
		}
		// biome-ignore lint/suspicious/noArrayIndexKey: static parse of a string
		return <span key={i}>{renderBackticks(part)}</span>;
	});
}

function renderBackticks(text: string): ReactNode {
	return text.split(/(`[^`]+`)/g).map((part, i) => {
		if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
			return (
				<code
					// biome-ignore lint/suspicious/noArrayIndexKey: static parse of a string
					key={i}
				>
					{part.slice(1, -1)}
				</code>
			);
		}
		return part;
	});
}

function Paragraphs({ text }: { text: string }) {
	return (
		<>
			{text.split(/\n{2,}/).map((paragraph) => (
				<p className="type-body-sm" key={paragraph}>
					{renderInline(paragraph)}
				</p>
			))}
		</>
	);
}

export interface GithubCommentMockProps {
	body: string | null;
	silentNote?: string;
}

export function GithubCommentMock({
	body,
	silentNote,
}: GithubCommentMockProps) {
	if (body === null) {
		return (
			<div className="rounded-panel border border-line-faint bg-paper">
				<Empty size="sm" variant="plain">
					<EmptyHeader>
						<EmptyTitle>No comment posts</EmptyTitle>
						{silentNote ? (
							<EmptyDescription>{silentNote}</EmptyDescription>
						) : null}
					</EmptyHeader>
				</Empty>
			</div>
		);
	}
	const blocks = parseBody(body);
	return (
		<div className="flex items-start gap-3">
			<Avatar decorative size="lg" type="source">
				<AvatarFallback>
					<GithubIcon className="size-(--icon)" />
				</AvatarFallback>
			</Avatar>
			<div className="min-w-0 flex-1 overflow-hidden rounded-panel border border-line-faint bg-paper">
				<div className="flex items-center gap-2 border-line-faint border-b px-3 py-2">
					<span className="type-label-sm">tripwire</span>
					<Badge size="sm" variant="outline">
						bot
					</Badge>
					<span className="type-caption text-text-2">commented just now</span>
				</div>
				<div className="flex flex-col gap-3 px-3 py-3">
					{blocks.map((block, i) => {
						if (block.kind === "paragraph") {
							return (
								// biome-ignore lint/suspicious/noArrayIndexKey: static parse
								<Paragraphs key={i} text={block.text} />
							);
						}
						if (block.kind === "button") {
							return (
								<img
									alt={block.alt}
									className="w-46"
									// biome-ignore lint/suspicious/noArrayIndexKey: static parse
									key={i}
									src={block.src}
								/>
							);
						}
						return (
							// biome-ignore lint/suspicious/noArrayIndexKey: static parse
							<details className="type-body-sm" key={i}>
								<summary className="cursor-pointer text-text-2">
									{block.summary}
								</summary>
								<div className="mt-2 flex flex-col gap-2">
									<Paragraphs text={block.body} />
								</div>
							</details>
						);
					})}
				</div>
			</div>
		</div>
	);
}
