import type { ComponentProps, ReactNode } from "react";

export interface PaginationProps extends ComponentProps<"nav"> {
	label?: string;
}

export function Pagination({
	label = "Pagination",
	...props
}: PaginationProps) {
	return <nav aria-label={label} data-slot="pagination" {...props} />;
}

export function PaginationList(props: ComponentProps<"ol">) {
	return <ol data-slot="pagination-list" {...props} />;
}

export interface PaginationLinkProps extends ComponentProps<"a"> {
	current?: boolean;
}

export function PaginationLink({ current, ...props }: PaginationLinkProps) {
	return (
		<a
			aria-current={current ? "page" : undefined}
			data-current={current || undefined}
			data-slot="pagination-link"
			{...props}
		/>
	);
}

export function PaginationPrevious({
	children = "Previous",
	...props
}: ComponentProps<"a">) {
	return (
		<a data-slot="pagination-previous" {...props}>
			{children}
		</a>
	);
}

export function PaginationNext({
	children = "Next",
	...props
}: ComponentProps<"a">) {
	return (
		<a data-slot="pagination-next" {...props}>
			{children}
		</a>
	);
}

export function PaginationEllipsis({
	children = "…",
	...props
}: ComponentProps<"span">) {
	return (
		<span aria-hidden="true" data-slot="pagination-ellipsis" {...props}>
			{children as ReactNode}
		</span>
	);
}

export interface PaginationInfoProps extends ComponentProps<"p"> {
	from: number;
	noun?: string;
	to: number;
	total?: number | null;
}

export function PaginationInfo({
	from,
	noun,
	to,
	total,
	...props
}: PaginationInfoProps) {
	const format = (value: number) => value.toLocaleString("en-US");
	return (
		<p data-slot="pagination-info" {...props}>
			<span data-slot="pagination-range">
				{format(from)}–{format(to)}
			</span>
			{total != null
				? ` of ${format(total)}${noun ? ` ${noun}` : ""}`
				: noun
					? ` ${noun}`
					: ""}
		</p>
	);
}
