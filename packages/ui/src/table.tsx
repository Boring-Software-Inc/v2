import { type ComponentProps, type JSX, type ReactNode, useId } from "react";
import { Button, IconButton } from "./button";
import {
	type EmptyReason,
	EmptyState,
	EmptyStateContent,
	EmptyStateDescription,
	EmptyStateHeader,
	EmptyStateTitle,
} from "./empty-state";
import type { InteractionDetails } from "./interaction";
import { Skeleton } from "./skeleton";

type TableElementProps<Tag extends keyof JSX.IntrinsicElements> = Omit<
	ComponentProps<Tag>,
	"className" | "style"
>;

export type TableFrame = "card" | "none";
export type TableSortDirection = "asc" | "desc" | false;

export interface TableProps
	extends Omit<TableElementProps<"table">, "frame" | "title"> {
	actions?: ReactNode;
	count?: ReactNode;
	density?: "compact" | "default";
	footer?: ReactNode;
	frame?: TableFrame;
	scrollLabel?: string;
	stickyHeader?: boolean;
	title?: ReactNode;
	toolbar?: ReactNode;
}

export function Table({
	actions,
	count,
	density = "default",
	footer,
	frame = "card",
	scrollLabel,
	stickyHeader = false,
	title,
	toolbar,
	...props
}: TableProps) {
	const titleId = useId();
	const scrollRegion = scrollLabel
		? { "aria-label": scrollLabel, role: "region", tabIndex: 0 }
		: undefined;
	const body = (
		<>
			{title != null ? (
				<TableTitle
					actions={actions}
					count={count}
					id={titleId}
					title={title}
				/>
			) : null}
			{toolbar != null ? <TableToolbar>{toolbar}</TableToolbar> : null}
			<div
				data-slot="table-container"
				data-sticky-header={stickyHeader || undefined}
				{...scrollRegion}
			>
				<table
					aria-labelledby={
						props["aria-label"] ? undefined : title ? titleId : undefined
					}
					data-density={density}
					data-slot="table"
					{...props}
				/>
			</div>
		</>
	);
	return (
		<div data-frame={frame} data-slot="table-frame">
			{frame === "card" ? <div data-slot="table-panel">{body}</div> : body}
			{footer != null ? <div data-slot="table-footer-row">{footer}</div> : null}
		</div>
	);
}

export interface TableTitleProps
	extends Omit<TableElementProps<"div">, "title"> {
	actions?: ReactNode;
	count?: ReactNode;
	title: ReactNode;
}

export function TableTitle({
	actions,
	count,
	title,
	...props
}: TableTitleProps) {
	return (
		<div data-slot="table-title" {...props}>
			<span data-slot="table-title-text">{title}</span>
			{count != null ? <span data-slot="table-count">{count}</span> : null}
			{actions != null ? (
				<span data-slot="table-actions">{actions}</span>
			) : null}
		</div>
	);
}

export function TableToolbar(props: TableElementProps<"div">) {
	return <div data-slot="table-toolbar" {...props} />;
}

export function TableHeader(props: TableElementProps<"thead">) {
	return <thead data-slot="table-header" {...props} />;
}

export function TableBody(props: TableElementProps<"tbody">) {
	return <tbody data-slot="table-body" {...props} />;
}

export function TableFooter(props: TableElementProps<"tfoot">) {
	return <tfoot data-slot="table-footer" {...props} />;
}

export interface TableRowProps extends TableElementProps<"tr"> {
	open?: boolean;
	selected?: boolean;
}

export function TableRow({ open, selected, ...props }: TableRowProps) {
	return (
		<tr
			aria-current={open ? "true" : undefined}
			aria-selected={selected}
			data-open={open || undefined}
			data-selected={selected || undefined}
			data-slot="table-row"
			{...props}
		/>
	);
}

export interface TableHeadProps extends TableElementProps<"th"> {
	numeric?: boolean;
	onSort?: (
		direction: Exclude<TableSortDirection, false>,
		details: InteractionDetails,
	) => unknown;
	sort?: TableSortDirection;
	sortLabel?: string;
}

export function TableHead({
	children,
	numeric = false,
	onSort,
	sort,
	sortLabel,
	...props
}: TableHeadProps) {
	const next = sort === "asc" ? "desc" : "asc";
	const sortable = onSort != null || sort !== undefined;
	return (
		<th
			aria-sort={
				sortable
					? sort === "asc"
						? "ascending"
						: sort === "desc"
							? "descending"
							: "none"
					: undefined
			}
			data-numeric={numeric || undefined}
			data-slot="table-head"
			scope="col"
			{...props}
		>
			{sortable ? (
				<Button
					ariaLabel={sortLabel}
					onAction={(details) => onSort?.(next, details)}
					size="small"
					trailingIcon={
						<span data-sort={sort || "none"}>
							{sort === "asc" ? "↑" : sort === "desc" ? "↓" : "↕"}
						</span>
					}
					variant="ghost"
				>
					{children}
				</Button>
			) : (
				children
			)}
		</th>
	);
}

export interface TableCellProps extends TableElementProps<"td"> {
	mono?: boolean;
	numeric?: boolean;
}

export function TableCell({ mono, numeric, ...props }: TableCellProps) {
	return (
		<td
			data-mono={mono || undefined}
			data-numeric={numeric || undefined}
			data-slot="table-cell"
			{...props}
		/>
	);
}

export function TableCaption(props: TableElementProps<"caption">) {
	return <caption data-slot="table-caption" {...props} />;
}

export interface TableEmptyProps
	extends Omit<TableElementProps<"td">, "title"> {
	action?: ReactNode;
	art?: ReactNode;
	colSpan: number;
	description?: ReactNode;
	reason?: Extract<EmptyReason, "empty" | "no-results" | "error">;
	title: ReactNode;
}

export function TableEmpty({
	action,
	art,
	colSpan,
	description,
	reason = "empty",
	title,
	...props
}: TableEmptyProps) {
	return (
		<tr data-slot="table-empty">
			<td colSpan={colSpan} {...props}>
				<EmptyState art={art} reason={reason} size="sm" variant="plain">
					<EmptyStateHeader>
						<EmptyStateTitle>{title}</EmptyStateTitle>
						{description != null ? (
							<EmptyStateDescription>{description}</EmptyStateDescription>
						) : null}
					</EmptyStateHeader>
					{action != null ? (
						<EmptyStateContent>{action}</EmptyStateContent>
					) : null}
				</EmptyState>
			</td>
		</tr>
	);
}

export interface TableLoadingProps {
	columns: number | { checkbox?: boolean; numeric?: boolean }[];
	hidden?: boolean;
	rows?: number;
}

export function TableLoading({
	columns,
	hidden = false,
	rows = 5,
}: TableLoadingProps) {
	const cells: { checkbox?: boolean; numeric?: boolean }[] = Array.isArray(
		columns,
	)
		? columns
		: Array.from({ length: columns }, () => ({}));
	const rowKeys = Array.from({ length: rows }, (_, row) => `row-${row + 1}`);
	const keyedCells = cells.map((cell, column) => ({
		...cell,
		key: `column-${column + 1}`,
	}));
	return rowKeys.map((rowKey) => (
		<tr
			data-hidden={hidden || undefined}
			data-slot="table-loading-row"
			key={rowKey}
		>
			{keyedCells.map((cell) => (
				<td
					data-checkbox={cell.checkbox || undefined}
					data-numeric={cell.numeric || undefined}
					key={cell.key}
				>
					<Skeleton />
				</td>
			))}
		</tr>
	));
}

export interface TableRowActionsProps extends TableElementProps<"fieldset"> {
	indicator?: ReactNode;
	revealOnHover?: boolean;
}

export function TableRowActions({
	"aria-label": ariaLabel = "Row actions",
	children,
	indicator,
	revealOnHover = true,
	...props
}: TableRowActionsProps) {
	return (
		<fieldset
			aria-label={ariaLabel}
			data-reveal-on-hover={revealOnHover || undefined}
			data-slot="table-row-actions"
			{...props}
		>
			{indicator != null ? (
				<span data-slot="table-row-indicator">{indicator}</span>
			) : null}
			<span data-slot="table-row-action-list">{children}</span>
		</fieldset>
	);
}

export interface TableRowActionProps {
	disabled?: boolean;
	icon: ReactNode;
	label: string;
	onAction?: (details: InteractionDetails) => unknown;
}

export function TableRowAction(props: TableRowActionProps) {
	return <IconButton {...props} size="small" variant="ghost" />;
}
