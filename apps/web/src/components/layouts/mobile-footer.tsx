import { RepoTabBar } from "#/components/tabs";

/**
 * On mobile the open-repo strip sits at the bottom, within thumb reach, while
 * the repo page tree rides inside the page shell (`ShellNav`) exactly as it does
 * on desktop. `md:hidden` on the nav itself so it leaves no ghost row on
 * desktop, where the same strip lives in the topbar.
 */
export function MobileFooter() {
	return (
		<RepoTabBar className="shrink-0 px-3 pt-2 pb-[max(var(--space-2),env(safe-area-inset-bottom))] md:hidden" />
	);
}
