import type { ComponentProps } from "react";

export interface SidebarShellProps extends ComponentProps<"aside"> {
	collapsed?: boolean;
	label?: string;
}

export function SidebarShell({
	collapsed,
	label = "Primary navigation",
	...props
}: SidebarShellProps) {
	return (
		<aside
			aria-label={label}
			data-collapsed={collapsed || undefined}
			data-slot="sidebar-shell"
			{...props}
		/>
	);
}

export function SidebarHeader(props: ComponentProps<"div">) {
	return <div data-slot="sidebar-header" {...props} />;
}

export function SidebarBody(props: ComponentProps<"div">) {
	return <div data-slot="sidebar-body" {...props} />;
}

export function SidebarNav(props: ComponentProps<"nav">) {
	return <nav data-slot="sidebar-nav" {...props} />;
}

export function SidebarFooter(props: ComponentProps<"div">) {
	return <div data-slot="sidebar-footer" {...props} />;
}
