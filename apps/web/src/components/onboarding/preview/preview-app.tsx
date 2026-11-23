import { useQuery } from "@tanstack/react-query";
import type { ForgeId } from "@tripwire/contracts";
import { UI_MOTION } from "@tripwire/ui/motion";
import { AnimatePresence, motion } from "motion/react";
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
import { accountIdentity } from "#/lib/current-user";

/** The signed-in user as the preview's account trigger shows them. */
export function usePreviewUser() {
	const { data: user } = useQuery(currentUserQueryOptions());
	return {
		name: user?.name ?? "",
		image: user?.image ?? null,
		/** The line under the name in the account menu. */
		identity: user ? accountIdentity(user) : null,
	};
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
			{/* An open menu dims the page under it and scales up from where it
			    opens, as the real popover does, and leaves the same way. */}
			<AnimatePresence initial={false}>
				{overlay ? (
					<motion.div
						animate={{ opacity: 1 }}
						data-layout-role="onboarding-preview-overlay"
						exit={{ opacity: 0 }}
						initial={{ opacity: 0 }}
						key="overlay"
						transition={UI_MOTION.column}
					>
						<motion.div
							animate={{ scale: 1 }}
							data-part="content"
							exit={{ scale: 0.96 }}
							initial={{ scale: 0.96 }}
							transition={UI_MOTION.column}
						>
							{overlay}
						</motion.div>
					</motion.div>
				) : null}
			</AnimatePresence>
		</PreviewWindow>
	);
}
