import { useQuery } from "@tanstack/react-query";
import type { ForgeId } from "@tripwire/contracts";
import type { ReactNode } from "react";
import {
	type PreviewNavKey,
	PreviewRail,
} from "#/components/onboarding/preview/preview-rail";
import {
	type PreviewUrl,
	PreviewWindow,
} from "#/components/onboarding/preview/preview-window";
import { currentUserQueryOptions } from "#/lib/auth.query";

/** The signed-in user as the preview's account trigger shows them. */
export function usePreviewUser() {
	const { data: user } = useQuery(currentUserQueryOptions());
	return { name: user?.name ?? "", image: user?.image ?? null };
}

/**
 * A Tripwire page in the preview window: the rail on page, the page on the
 * paper panel inset beside it, as the dashboard shell lays them out.
 */
export function PreviewApp({
	url,
	repo,
	forge,
	active,
	collapsed,
	overlay,
	children,
}: {
	url: PreviewUrl;
	repo: string | null;
	forge?: ForgeId;
	active: PreviewNavKey;
	collapsed?: boolean;
	/** Something floating over the page, like an open menu. */
	overlay?: ReactNode;
	children: ReactNode;
}) {
	const user = usePreviewUser();
	return (
		<PreviewWindow url={url}>
			<PreviewRail
				active={active}
				collapsed={collapsed}
				forge={forge}
				repo={repo}
				userImage={user.image}
				userName={user.name}
			/>
			<div data-layout-role="onboarding-preview-panel">
				<div data-part="body">{children}</div>
			</div>
			{overlay}
		</PreviewWindow>
	);
}
