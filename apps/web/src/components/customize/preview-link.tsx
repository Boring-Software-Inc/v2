import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useState,
} from "react";

export type PreviewRegion =
	| "comment"
	| "comment-body"
	| "details-button"
	| "check";

export const SETTING_REGION = {
	"post-comment": "comment",
	content: "comment-body",
	"rule-names": "comment-body",
	message: "comment-body",
	"details-button": "details-button",
	"check-run": "check",
} as const satisfies Record<string, PreviewRegion>;

export type PreviewSetting = keyof typeof SETTING_REGION;

const FALLBACK: Partial<Record<PreviewRegion, PreviewRegion>> = {
	"details-button": "comment-body",
	"comment-body": "comment",
};

const ACTIVE = "data-region-active";
const FLASH = "data-region-flash";

export interface PreviewLink {
	attach: (root: HTMLElement) => () => void;
	focus: (setting: PreviewSetting | null, el: HTMLElement) => void;
	release: (el: HTMLElement) => void;
	flash: (setting: PreviewSetting) => void;
	refresh: () => void;
}

function regionsIn(root: HTMLElement, region: PreviewRegion): HTMLElement[] {
	let current: PreviewRegion | undefined = region;
	while (current) {
		const found = [
			...root.querySelectorAll<HTMLElement>(`[data-region="${current}"]`),
		];
		if (found.length > 0) {
			return found;
		}
		current = FALLBACK[current];
	}
	return [];
}

function createPreviewLink(): PreviewLink {
	let root: HTMLElement | null = null;
	let focused: { setting: PreviewSetting; el: HTMLElement } | null = null;

	const apply = () => {
		if (!root) {
			return;
		}
		for (const el of root.querySelectorAll(`[${ACTIVE}]`)) {
			el.removeAttribute(ACTIVE);
		}
		const setting = focused?.setting;
		const targets = setting ? regionsIn(root, SETTING_REGION[setting]) : [];
		if (!setting || targets.length === 0) {
			root.removeAttribute("data-highlight");
			return;
		}
		root.setAttribute("data-highlight", SETTING_REGION[setting]);
		for (const el of targets) {
			el.setAttribute(ACTIVE, "");
		}
	};

	return {
		attach: (el) => {
			root = el;
			apply();
			return () => {
				if (root === el) {
					root = null;
				}
			};
		},
		focus: (setting, el) => {
			if (setting) {
				focused = { setting, el };
			} else if (focused?.el === el) {
				focused = null;
			}
			apply();
		},
		release: (el) => {
			if (focused?.el === el) {
				focused = null;
				apply();
			}
		},
		refresh: apply,
		flash: (setting) => {
			requestAnimationFrame(() => {
				if (!root) {
					return;
				}
				for (const el of regionsIn(root, SETTING_REGION[setting])) {
					el.removeAttribute(FLASH);
					void el.offsetWidth;
					el.setAttribute(FLASH, "");
					el.addEventListener("animationend", () => el.removeAttribute(FLASH), {
						once: true,
					});
				}
			});
		},
	};
}

const PreviewLinkContext = createContext<PreviewLink | null>(null);

export function PreviewLinkProvider({ children }: { children: ReactNode }) {
	const [link] = useState(createPreviewLink);
	return <PreviewLinkContext value={link}>{children}</PreviewLinkContext>;
}

export function usePreviewLink(): PreviewLink {
	const link = useContext(PreviewLinkContext);
	if (!link) {
		throw new Error("usePreviewLink needs a PreviewLinkProvider");
	}
	return link;
}

export function PreviewLinked({
	setting,
	children,
}: {
	setting: PreviewSetting;
	children: ReactNode;
}) {
	const link = usePreviewLink();
	const wire = useCallback(
		(el: HTMLDivElement | null) => {
			if (!el) {
				return;
			}
			const focusIn = (event: FocusEvent) => {
				const target = event.target as HTMLElement | null;
				link.focus(target?.matches(":focus-visible") ? setting : null, el);
			};
			const focusOut = (event: FocusEvent) => {
				if (!el.contains(event.relatedTarget as Node | null)) {
					link.focus(null, el);
				}
			};
			el.addEventListener("focusin", focusIn);
			el.addEventListener("focusout", focusOut);
			return () => {
				el.removeEventListener("focusin", focusIn);
				el.removeEventListener("focusout", focusOut);
				link.release(el);
			};
		},
		[link, setting],
	);
	return <div ref={wire}>{children}</div>;
}
