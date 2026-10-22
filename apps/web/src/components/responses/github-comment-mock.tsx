import { COMMENT_MARKER } from "@tripwire/contracts";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { AnimatedHeight } from "#/components/common/animated-height";
import { TripwireLogo } from "#/components/common/tripwire-logo";
import { Badge } from "#/components/glaze/ui/badge";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "#/components/glaze/ui/empty-state";
import {
	BLUR_SWAP,
	keyedByContent,
} from "#/components/responses/preview-motion";
import { PreviewObject } from "#/components/responses/preview-object";

type BodyBlock =
	| { kind: "paragraph"; text: string }
	| { kind: "list"; items: string[] }
	| { kind: "details"; summary: string; body: string }
	| { kind: "link"; href: string; text: string };

const DETAILS_RE =
	/<details><summary>(.*?)<\/summary>\n\n([\s\S]*?)\n<\/details>/;
const LINK_RE = /<a href="([^"]*)">([^<]*)<\/a>/;
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
		const link = LINK_RE.exec(rest);
		const next = [details, link]
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
		} else if (link) {
			blocks.push({
				kind: "link",
				href: link[1] ?? "",
				text: link[2] ?? "",
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

function blockKey(block: BodyBlock): string {
	if (block.kind === "paragraph") {
		return `p:${block.text}`;
	}
	if (block.kind === "list") {
		return `ul:${block.items.join("\n")}`;
	}
	if (block.kind === "link") {
		return `link:${block.text}`;
	}
	return `details:${block.summary}\n${block.body}`;
}

const BLOCK_MOTION = { ...BLUR_SWAP, layout: "position" } as const;

function Markdown({ blocks }: { blocks: BodyBlock[] }) {
	return (
		<AnimatePresence initial={false} mode="popLayout">
			{keyedByContent(blocks, blockKey).map(({ item: block, key }) => {
				if (block.kind === "paragraph") {
					return (
						<motion.p
							className="whitespace-pre-line"
							data-dim=""
							key={key}
							{...BLOCK_MOTION}
						>
							{renderInline(block.text)}
						</motion.p>
					);
				}
				if (block.kind === "list") {
					return (
						<motion.ul
							className="flex list-disc flex-col gap-1 ps-6"
							data-dim=""
							key={key}
							{...BLOCK_MOTION}
						>
							{block.items.map((item) => (
								<li key={item}>{renderInline(item)}</li>
							))}
						</motion.ul>
					);
				}
				if (block.kind === "link") {
					return (
						<motion.p
							className="relative w-fit rounded-tag underline underline-offset-2"
							data-dim=""
							data-region="details-button"
							key={key}
							{...BLOCK_MOTION}
						>
							{block.text}
						</motion.p>
					);
				}
				return (
					<motion.details data-dim="" key={key} {...BLOCK_MOTION}>
						<summary className="cursor-pointer">{block.summary}</summary>
						<div className="mt-3 flex flex-col gap-4">
							<Markdown blocks={textBlocks(block.body)} />
						</div>
					</motion.details>
				);
			})}
		</AnimatePresence>
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
	return (
		<AnimatedHeight>
			<AnimatePresence initial={false} mode="wait">
				{body === null ? (
					<motion.div key="silent" {...BLUR_SWAP}>
						<SilentComment note={silentNote} />
					</motion.div>
				) : (
					<motion.div key="comment" {...BLUR_SWAP}>
						<PostedComment body={body} />
					</motion.div>
				)}
			</AnimatePresence>
		</AnimatedHeight>
	);
}

function SilentComment({ note }: { note?: string }) {
	return (
		<div className="sm:ms-13" data-dim="">
			<PreviewObject>
				<Empty size="sm" variant="plain">
					<EmptyHeader>
						<EmptyTitle>Tripwire posts no comment</EmptyTitle>
						{note ? <EmptyDescription>{note}</EmptyDescription> : null}
					</EmptyHeader>
				</Empty>
			</PreviewObject>
		</div>
	);
}

function PostedComment({ body }: { body: string }) {
	const blocks = parseBody(body);
	return (
		<div className="flex items-start gap-3">
			<span
				aria-hidden
				className="hidden size-10 shrink-0 items-center justify-center rounded-tag bg-paper text-text-1 sm:flex forced-colors:border forced-colors:border-[CanvasText]"
				data-dim=""
			>
				<TripwireLogo size={22} />
			</span>
			<article className="min-w-0 flex-1">
				<PreviewObject>
					<header
						className="flex flex-wrap items-center gap-x-1.5 gap-y-1 bg-shell px-4 py-2"
						data-dim=""
					>
						<span className="type-label font-semibold text-text-1">
							tripwire
						</span>
						<Badge size="sm" variant="outline">
							bot
						</Badge>
						<span className="type-body-sm text-text-2">commented just now</span>
					</header>
					<div className="p-2">
						<div
							className="relative rounded-tag px-2 py-2 type-body text-text-1"
							data-region="comment-body"
						>
							<AnimatedHeight>
								<div className="flex flex-col gap-4">
									<Markdown blocks={blocks} />
								</div>
							</AnimatedHeight>
						</div>
					</div>
				</PreviewObject>
			</article>
		</div>
	);
}
