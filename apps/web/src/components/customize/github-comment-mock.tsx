import { COMMENT_MARKER } from "@tripwire/contracts";
import type { ReactNode } from "react";
import { TripwireLogo } from "#/components/common/tripwire-logo";
import { Badge } from "#/components/glaze/ui/badge";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "#/components/glaze/ui/empty-state";

type BodyBlock =
	| { kind: "paragraph"; text: string }
	| { kind: "list"; items: string[] }
	| { kind: "details"; summary: string; body: string }
	| { kind: "button"; href: string; src: string; alt: string };

const DETAILS_RE =
	/<details><summary>(.*?)<\/summary>\n\n([\s\S]*?)\n<\/details>/;
const BUTTON_RE =
	/<a href="([^"]*)"><img src="([^"]*)"[^>]*alt="([^"]*)" \/><\/a>/;
const LIST_ITEM_RE = /^\s*[-*]\s+/;

function textBlocks(text: string): BodyBlock[] {
	const blocks: BodyBlock[] = [];
	for (const chunk of text.split(/\n{2,}/)) {
		const trimmed = chunk.trim();
		if (!trimmed) {
			continue;
		}
		const lines = trimmed.split("\n");
		if (lines.every((line) => LIST_ITEM_RE.test(line))) {
			blocks.push({
				kind: "list",
				items: lines.map((line) => line.replace(LIST_ITEM_RE, "")),
			});
		} else {
			blocks.push({ kind: "paragraph", text: trimmed });
		}
	}
	return blocks;
}

function parseBody(body: string): BodyBlock[] {
	const blocks: BodyBlock[] = [];
	let rest = body.replaceAll(COMMENT_MARKER, "").trim();
	while (rest.length > 0) {
		const details = DETAILS_RE.exec(rest);
		const button = BUTTON_RE.exec(rest);
		const next = [details, button]
			.filter((m): m is RegExpExecArray => m !== null)
			.sort((a, b) => a.index - b.index)[0];
		blocks.push(...textBlocks(next ? rest.slice(0, next.index) : rest));
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

const INLINE_RE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|@[A-Za-z0-9-]+)/g;

function renderInline(text: string): ReactNode[] {
	return text.split(INLINE_RE).map((part, i) => {
		const key = `${i}-${part}`;
		if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
			return (
				<strong className="font-semibold" key={key}>
					{renderInline(part.slice(2, -2))}
				</strong>
			);
		}
		if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
			return <code key={key}>{part.slice(1, -1)}</code>;
		}
		const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
		if (link) {
			return (
				<span className="underline underline-offset-2" key={key}>
					{link[1]}
				</span>
			);
		}
		if (/^@[A-Za-z0-9-]+$/.test(part)) {
			return (
				<span className="font-semibold" key={key}>
					{part}
				</span>
			);
		}
		return part;
	});
}

function Markdown({ blocks }: { blocks: BodyBlock[] }) {
	return (
		<>
			{blocks.map((block, i) => {
				const key = `${block.kind}-${i}`;
				if (block.kind === "paragraph") {
					return (
						<p className="whitespace-pre-line" data-dim="" key={key}>
							{renderInline(block.text)}
						</p>
					);
				}
				if (block.kind === "list") {
					return (
						<ul
							className="flex list-disc flex-col gap-1 ps-6"
							data-dim=""
							key={key}
						>
							{block.items.map((item) => (
								<li key={item}>{renderInline(item)}</li>
							))}
						</ul>
					);
				}
				if (block.kind === "button") {
					return (
						<div
							className="relative w-fit rounded-tag"
							data-dim=""
							data-region="details-button"
							key={key}
						>
							<img alt={block.alt} className="w-46" src={block.src} />
						</div>
					);
				}
				return (
					<details data-dim="" key={key}>
						<summary className="cursor-pointer">{block.summary}</summary>
						<div className="mt-3 flex flex-col gap-4">
							<Markdown blocks={textBlocks(block.body)} />
						</div>
					</details>
				);
			})}
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
			<div
				className="rounded-panel border border-line-faint bg-paper"
				data-dim=""
			>
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
			<span
				aria-hidden
				className="hidden size-10 shrink-0 items-center justify-center rounded-tag border border-line-faint bg-paper text-text-1 sm:flex"
				data-dim=""
			>
				<TripwireLogo size={22} />
			</span>
			<article className="min-w-0 flex-1 overflow-hidden rounded-tag border border-line bg-paper">
				<header
					className="flex flex-wrap items-center gap-x-1.5 gap-y-1 border-line border-b bg-shell px-4 py-2"
					data-dim=""
				>
					<span className="type-label font-semibold text-text-1">tripwire</span>
					<Badge size="sm" variant="outline">
						bot
					</Badge>
					<span className="type-body-sm text-text-2">commented just now</span>
				</header>
				<div
					className="relative flex flex-col gap-4 px-4 py-4 type-body text-text-1"
					data-region="comment-body"
				>
					<Markdown blocks={blocks} />
				</div>
			</article>
		</div>
	);
}
