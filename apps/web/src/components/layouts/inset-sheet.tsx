import {
	DialogBody,
	DialogContent,
	type DialogContentProps,
} from "#/components/glaze/ui/dialog";
import { cn, mergeClass } from "#/lib/glaze/utils";

export function InsetSheetContent({
	className,
	...props
}: Omit<DialogContentProps, "size">) {
	return (
		<DialogContent
			data-side="sheet"
			className={mergeClass(
				"top-auto -bottom-(--radius-shell) h-[calc(100dvh-var(--space-10)+var(--radius-shell))] max-h-none w-[calc(100%-var(--space-2)*2)] translate-y-0 rounded-b-none",
				className,
			)}
			size="lg"
			{...props}
		/>
	);
}

export function InsetSheetBody({
	className,
	...props
}: React.ComponentProps<typeof DialogBody>) {
	return (
		<DialogBody
			className={cn(
				"pb-[calc(var(--space-4)+var(--radius-shell)+env(safe-area-inset-bottom))]",
				className,
			)}
			{...props}
		/>
	);
}
