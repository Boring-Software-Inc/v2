import type { ComponentProps, ReactNode } from "react";

export interface DataListProps extends ComponentProps<"dl"> {
	orientation?: "horizontal" | "vertical";
	variant?: "plain" | "panel";
}

export function DataList({
	className,
	orientation = "horizontal",
	variant = "plain",
	...props
}: DataListProps) {
	return (
		<div
			className={["ui-data-list", className].filter(Boolean).join(" ")}
			data-orientation={orientation}
			data-slot="data-list-frame"
			data-variant={variant}
		>
			<dl data-slot="data-list" {...props} />
		</div>
	);
}

export function DataListItem(props: ComponentProps<"div">) {
	return <div data-slot="data-list-item" {...props} />;
}

export function DataListLabel(props: ComponentProps<"dt">) {
	return <dt data-slot="data-list-label" {...props} />;
}

export interface DataListValueProps extends ComponentProps<"dd"> {
	mono?: boolean;
}

function isEmpty(value: ReactNode) {
	return value == null || value === false || value === "";
}

export function DataListValue({
	children,
	mono,
	...props
}: DataListValueProps) {
	const empty = isEmpty(children);
	return (
		<dd
			data-empty={empty || undefined}
			data-mono={mono || undefined}
			data-slot="data-list-value"
			{...props}
		>
			{empty ? <DataListEmpty /> : children}
		</dd>
	);
}

export function DataListEmpty({
	children = "None",
	...props
}: ComponentProps<"span">) {
	return (
		<span data-slot="data-list-empty" {...props}>
			{children}
		</span>
	);
}
