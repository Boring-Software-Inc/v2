import type { ReactNode } from "react";

export function PreviewObject({
	children,
	clip = true,
}: {
	children: ReactNode;
	clip?: boolean;
}) {
	return (
		<div className="flex min-w-0 flex-col">
			<div className="rounded-shell bg-hover p-(--shell-inset)">
				<div
					className={`rounded-panel bg-paper forced-colors:border forced-colors:border-[CanvasText] ${clip ? "overflow-hidden" : ""}`}
				>
					{children}
				</div>
			</div>
		</div>
	);
}
