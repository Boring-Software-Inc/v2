import type { ReactNode } from "react";
import { cn } from "#/lib/glaze/utils";

export function SheetSectionBlock({
	id,
	title,
	action,
	children,
}: {
	id: string;
	title: string;
	action?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section
			aria-labelledby={`user-sheet-${id}-title`}
			className="flex scroll-mt-14 flex-col gap-4"
			data-section={id}
			id={`user-sheet-${id}`}
		>
			<div className="flex min-h-7 items-center justify-between gap-3">
				<h3
					className="type-heading-sm text-text-1"
					id={`user-sheet-${id}-title`}
				>
					{title}
				</h3>
				{action}
			</div>
			{children}
		</section>
	);
}

export function SubHeading({
	title,
	count,
	action,
}: {
	title: string;
	count?: number;
	action?: ReactNode;
}) {
	return (
		<div className="flex min-h-8 items-center justify-between gap-3">
			<h4 className="type-label text-text-1">{title}</h4>
			{action ??
				(count !== undefined ? (
					<span className="type-caption text-text-2 tabular-nums">{count}</span>
				) : null)}
		</div>
	);
}

export function FieldRows({ children }: { children: ReactNode }) {
	return <dl className="flex flex-col">{children}</dl>;
}

export function FieldRow({
	label,
	children,
	className,
}: {
	label: ReactNode;
	children: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"flex min-h-9 flex-col gap-1 border-line-faint border-b py-2 last:border-b-0 sm:flex-row sm:items-center sm:gap-4",
				className,
			)}
		>
			<dt className="shrink-0 type-body-sm text-text-2 sm:w-35">{label}</dt>
			<dd className="flex min-w-0 flex-1 items-center gap-2 type-body-sm text-text-1">
				{children}
			</dd>
		</div>
	);
}

export function ListRows({
	label,
	children,
}: {
	label: string;
	children: ReactNode;
}) {
	return (
		<ul aria-label={label} className="flex flex-col">
			{children}
		</ul>
	);
}

export function ListRow({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<li
			className={cn(
				"flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1 border-line-faint border-b py-2 type-body-sm sm:flex-nowrap",
				className,
			)}
		>
			{children}
		</li>
	);
}

export function QuietLine({ children }: { children: ReactNode }) {
	return <p className="type-body-sm text-text-2">{children}</p>;
}
