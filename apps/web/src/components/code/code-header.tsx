import type { ReactNode } from "react";
import { FileCode, Icon } from "#/components/glaze/icon";

export interface DiffStats {
	added: number;
	removed: number;
}

export interface CodeHeaderProps {
	name: string;
	stats?: DiffStats;
	children: ReactNode;
}

export function CodeHeader({ name, stats, children }: CodeHeaderProps) {
	return (
		<div className="flex h-10 min-w-0 items-center gap-2 border-line-faint border-b ps-3.5 pe-1.5">
			<Icon className="text-text-2" icon={FileCode} />
			<span className="min-w-0 truncate type-code-block text-text-1">
				{name}
			</span>
			{stats ? (
				<span className="flex shrink-0 gap-1.5 type-code-block tabular-nums">
					{stats.added > 0 ? (
						<span className="text-ok-text">
							<span className="sr-only">Added lines </span>+{stats.added}
						</span>
					) : null}
					{stats.removed > 0 ? (
						<span className="text-fail-text">
							<span className="sr-only">Removed lines </span>-{stats.removed}
						</span>
					) : null}
				</span>
			) : null}
			<div className="ms-auto flex shrink-0 items-center gap-1">{children}</div>
		</div>
	);
}
