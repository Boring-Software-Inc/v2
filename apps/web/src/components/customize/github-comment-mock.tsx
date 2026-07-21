import { COMMENT_MARKER } from "@tripwire/contracts";
import type { ReactNode } from "react";
import { GithubIcon } from "#/components/icons/github";
import { Badge } from "#/components/ui/badge";

/**
 * A mock GitHub change-request comment, honest to what the renderer emits: the
 * comment bodies use a tiny markdown/HTML subset (bold, paragraphs,
 * details/summary, one linked button image, backtick chips), so this renders
 * exactly that subset — no markdown library. Tripwire tokens, not GitHub's
 * greys: the mock sits inside the app's chrome, it doesn't cosplay the site.
 */

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

/** Bold + backtick chips — the only inline constructs the renderer emits. */
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
					className="rounded bg-surface-2 px-1 py-px font-mono text-[11.5px]"
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
				<p className="text-[13px] leading-5" key={paragraph}>
					{renderInline(paragraph)}
				</p>
			))}
		</>
	);
}

export interface GithubCommentMockProps {
	/** The rendered comment body; null when the config posts no comment. */
	body: string | null;
	/** Shown in the empty state: what still surfaces without a comment. */
	silentNote?: string;
}

export function GithubCommentMock({
	body,
	silentNote,
}: GithubCommentMockProps) {
	if (body === null) {
		return (
			<div className="flex flex-col items-center gap-1 rounded-xl bg-surface-1 px-4 py-8 text-center">
				<p className="text-muted-foreground text-xs">no comment posts.</p>
				{silentNote ? (
					<p className="text-muted-foreground text-xs">{silentNote}</p>
				) : null}
			</div>
		);
	}
	const blocks = parseBody(body);
	return (
		<div className="flex items-start gap-3">
			<div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-1">
				<GithubIcon className="size-4 text-foreground" />
			</div>
			<div className="min-w-0 flex-1 overflow-hidden rounded-xl bg-surface-1">
				<div className="flex items-center gap-2 px-3.5 py-2.5">
					<span className="font-medium text-xs">tripwire</span>
					<Badge className="px-1.5 py-0 text-[10px]" variant="outline">
						bot
					</Badge>
					<span className="text-[11px] text-muted-foreground">
						commented just now
					</span>
				</div>
				<div className="flex flex-col gap-3 px-3.5 pt-0.5 pb-3.5">
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
									className="w-[185px]"
									// biome-ignore lint/suspicious/noArrayIndexKey: static parse
									key={i}
									src={block.src}
								/>
							);
						}
						return (
							// biome-ignore lint/suspicious/noArrayIndexKey: static parse
							<details className="text-[13px] leading-5" key={i}>
								<summary className="cursor-pointer text-muted-foreground">
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
