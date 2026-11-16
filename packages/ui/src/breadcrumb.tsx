import type { ComponentProps } from "react";

export interface BreadcrumbProps extends ComponentProps<"nav"> {
	label?: string;
}

export function Breadcrumb({
	label = "Breadcrumb",
	...props
}: BreadcrumbProps) {
	return <nav aria-label={label} data-slot="breadcrumb" {...props} />;
}

export function BreadcrumbList(props: ComponentProps<"ol">) {
	return <ol data-slot="breadcrumb-list" {...props} />;
}

export function BreadcrumbItem(props: ComponentProps<"li">) {
	return <li data-slot="breadcrumb-item" {...props} />;
}

export function BreadcrumbLink(props: ComponentProps<"a">) {
	return <a data-slot="breadcrumb-link" {...props} />;
}

export function BreadcrumbPage(props: ComponentProps<"span">) {
	return <span aria-current="page" data-slot="breadcrumb-page" {...props} />;
}

export function BreadcrumbSeparator({
	children = "/",
	...props
}: ComponentProps<"li">) {
	return (
		<li aria-hidden="true" data-slot="breadcrumb-separator" {...props}>
			{children}
		</li>
	);
}
