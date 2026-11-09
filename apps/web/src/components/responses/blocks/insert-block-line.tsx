import { Add, Icon } from "#/design-system/icon";
import { Button } from "#/design-system/ui/button";

export interface InsertBlockLineProps {
	index: number;
	onInsert: (index: number) => void;
}

export function InsertBlockLine({ index, onInsert }: InsertBlockLineProps) {
	return (
		<li
			className="group/insert relative z-(--z-raised) h-0 shrink-0"
			data-insert-slot={index}
		>
			<span
				aria-hidden
				className="absolute inset-x-0 top-0 h-6 -translate-y-1/2"
			/>
			<span
				aria-hidden
				className="absolute inset-x-2 top-0 h-px bg-line-control opacity-0 transition-opacity duration-(--dur-state) group-hover/insert:opacity-100 group-focus-within/insert:opacity-100"
			/>
			<Button
				aria-label={`Add block at position ${index + 1}`}
				className="absolute start-1/2 top-0 -translate-x-1/2 -translate-y-1/2 opacity-0 transition-opacity duration-(--dur-state) group-hover/insert:opacity-100 group-focus-within/insert:opacity-100 pointer-coarse:start-auto pointer-coarse:end-1 pointer-coarse:translate-x-0 pointer-coarse:opacity-100 rtl:translate-x-1/2"
				onClick={() => onInsert(index)}
				size="sm"
				variant="secondary"
			>
				<Icon icon={Add} />
				<span className="pointer-coarse:hidden">Add block</span>
			</Button>
		</li>
	);
}
