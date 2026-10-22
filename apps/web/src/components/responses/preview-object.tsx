import type { ReactNode } from "react";

export function PreviewObject({ children }: { children: ReactNode }) {
	return (
		<div className="flex min-w-0 flex-col">
			<div className="rounded-shell bg-hover p-(--shell-inset)">
				<div className="overflow-hidden rounded-panel bg-paper forced-colors:border forced-colors:border-[CanvasText]">
					{children}
				</div>
			</div>
		</div>
	);
}
