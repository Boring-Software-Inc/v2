import type { ReactNode } from "react";
import { Page } from "#/components/layouts/page";

export function ModerationPageFrame({ children }: { children: ReactNode }) {
	return (
		<Page purpose="task">
			<div data-layout-role="moderation-page">{children}</div>
		</Page>
	);
}
