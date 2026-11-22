import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { BADGE_PATH, BADGE_WIDTH, RUN_LINK_TEXT } from "@tripwire/contracts";

const RUN_BUTTON_PATTERN = new RegExp(
	`<a href="([^"]+)"><img src="[^"]+${BADGE_PATH.replaceAll("/", "\\/")}" width="${BADGE_WIDTH}" alt="${RUN_LINK_TEXT}" \\/><\\/a>`,
	"g",
);

export interface GitCafeRunBadge {
	bytes: Uint8Array;
	sha256: string;
}

let badge: Promise<GitCafeRunBadge> | undefined;

export function needsGitCafeRunBadge(body: string): boolean {
	RUN_BUTTON_PATTERN.lastIndex = 0;
	return RUN_BUTTON_PATTERN.test(body);
}

export function renderGitCafeRunBadge(
	body: string,
	attachmentUrl: string,
): string {
	RUN_BUTTON_PATTERN.lastIndex = 0;
	return body.replace(RUN_BUTTON_PATTERN, (_match, runUrl: string) => {
		try {
			const parsed = new URL(runUrl);
			if (parsed.protocol !== "https:") return _match;
		} catch {
			return _match;
		}
		return `[![${RUN_LINK_TEXT}](${attachmentUrl})](${runUrl})`;
	});
}

export function loadGitCafeRunBadge(): Promise<GitCafeRunBadge> {
	badge ??= readFile(new URL("./assets/view-run.png", import.meta.url)).then(
		(bytes) => ({
			bytes,
			sha256: createHash("sha256").update(bytes).digest("hex"),
		}),
	);
	return badge;
}
