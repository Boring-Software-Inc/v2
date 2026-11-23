import {
	Add,
	BrowserSidebar,
	ChevronLeft,
	ChevronRight,
	Icon,
	Locked,
	More,
	Retry,
} from "@tripwire/ui/icon";
import type { ReactNode } from "react";

export interface PreviewUrl {
	host: string;
	path?: string;
}

/**
 * The browser a preview page sits in. It is wider than the preview column on
 * purpose: the page runs off the right edge, so it reads as the full app seen
 * through a window rather than a shrunken copy of it.
 */
export function PreviewWindow({
	url,
	children,
}: {
	url: PreviewUrl;
	children: ReactNode;
}) {
	return (
		<div aria-hidden="true" data-layout-role="onboarding-window" inert>
			<div data-layout-role="onboarding-window-chrome">
				<div data-layout-role="onboarding-window-lights">
					<span />
					<span />
					<span />
				</div>
				<div data-layout-role="onboarding-window-nav">
					<span>
						<Icon icon={BrowserSidebar} size={16} />
					</span>
					<span>
						<Icon icon={ChevronLeft} size={16} />
					</span>
					<span data-disabled="true">
						<Icon icon={ChevronRight} size={16} />
					</span>
					<span>
						<Icon icon={Retry} size={14} />
					</span>
				</div>
				<div data-layout-role="onboarding-window-omnibox">
					<Icon icon={Locked} size={12} />
					<span>
						<span data-part="host">{url.host}</span>
						{url.path}
					</span>
				</div>
				<div data-layout-role="onboarding-window-nav">
					<span>
						<Icon icon={Add} size={16} />
					</span>
					<span>
						<Icon icon={More} size={16} />
					</span>
				</div>
			</div>
			<div data-layout-role="onboarding-window-body">{children}</div>
		</div>
	);
}
