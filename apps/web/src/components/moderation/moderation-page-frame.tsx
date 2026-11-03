import type { ReactNode } from "react";

export function ModerationPageFrame({ children }: { children: ReactNode }) {
	return <div data-layout-role="moderation-page">{children}</div>;
}
