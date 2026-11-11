import type { ReactNode } from "react";
import {
	HistoryBackControl,
	useCanGoBack,
} from "#/components/common/history-back-control";
import { PageHeader } from "#/components/layouts/page";
import {
	Section,
	SectionBody,
	SectionHeader,
} from "#/components/layouts/section";
import { SidebarNav, sidebarNavItemClass } from "#/design-system/ui/sidebar";
import { Skeleton, SkeletonText } from "#/design-system/ui/skeleton";
import { Label } from "#/design-system/ui/typography";

export function SettingsFrame({
	nav,
	children,
}: {
	nav: ReactNode;
	children: ReactNode;
}) {
	return (
		<div data-layout-role="settings-frame">
			<div data-layout-role="settings-grid">
				<div className="md:hidden">{nav}</div>
				<div data-layout-role="settings-page">{children}</div>
			</div>
		</div>
	);
}

export function SettingsHeader({
	title,
	children,
}: {
	title: string;
	children?: ReactNode;
}) {
	const canGoBack = useCanGoBack();
	return (
		<PageHeader
			actions={children}
			navigation={
				canGoBack ? (
					<div className="md:hidden">
						<HistoryBackControl />
					</div>
				) : undefined
			}
			title={title}
		/>
	);
}

export function SettingsSection({
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
		<Section id={id}>
			<SectionHeader actions={action} title={title} />
			<SectionBody>{children}</SectionBody>
		</Section>
	);
}

export function SettingsCard({ children }: { children: ReactNode }) {
	return <div data-layout-role="settings-card">{children}</div>;
}

const SETTINGS_NAV_SLOTS = ["a", "b", "c", "d", "e", "f"] as const;

export function SettingsNavSkeleton({
	variant = "mobile",
	collapsed = false,
}: {
	variant?: "mobile" | "rail";
	collapsed?: boolean;
}) {
	if (variant === "rail") {
		return (
			<SidebarNav aria-hidden>
				{SETTINGS_NAV_SLOTS.map((slot) => (
					<div className={sidebarNavItemClass({ collapsed })} key={slot}>
						<Skeleton className="size-4 rounded-tag" />
						{collapsed ? null : (
							<SkeletonText data-layout-size="medium" type="label" />
						)}
					</div>
				))}
			</SidebarNav>
		);
	}
	return (
		<div aria-hidden data-layout-role="settings-nav-skeleton">
			{SETTINGS_NAV_SLOTS.map((slot) => (
				<div data-layout-role="settings-nav-skeleton-item" key={slot}>
					<SkeletonText data-layout-size="medium" type="label" />
				</div>
			))}
		</div>
	);
}

export function SettingsContentSkeleton() {
	return (
		<div aria-hidden data-layout-role="settings-page">
			<div data-layout-role="settings-content-skeleton-heading">
				<SkeletonText data-layout-size="wide" type="heading" />
			</div>
			<div data-layout-role="settings-content-skeleton-card">
				<Skeleton />
			</div>
		</div>
	);
}

export function SettingsDangerRow({
	label,
	action,
	children,
}: {
	label: string;
	action: ReactNode;
	children?: ReactNode;
}) {
	return (
		<div data-layout-role="settings-danger-row">
			<div>
				<Label>{label}</Label>
			</div>
			{action}
			{children}
		</div>
	);
}
