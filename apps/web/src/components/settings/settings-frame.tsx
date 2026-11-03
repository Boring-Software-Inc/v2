import type { ReactNode } from "react";
import { PageHeader } from "#/components/layouts/page";
import {
	Section,
	SectionBody,
	SectionHeader,
} from "#/components/layouts/section";
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
		<div className="px-4 py-6 md:px-8 md:py-10">
			<div className="mx-auto grid w-full max-w-260 grid-cols-1 gap-6 md:grid-cols-[--spacing(50)_minmax(0,1fr)] md:gap-12">
				{nav}
				<div
					className="flex min-w-0 flex-col gap-6"
					data-layout-role="settings-page"
				>
					{children}
				</div>
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
	return <PageHeader actions={children} title={title} />;
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
	return <div className="shell">{children}</div>;
}

const SETTINGS_NAV_SLOTS = ["a", "b", "c", "d", "e", "f"] as const;

export function SettingsNavSkeleton() {
	return (
		<div aria-hidden className="hidden flex-col gap-1 md:flex">
			{SETTINGS_NAV_SLOTS.map((slot) => (
				<div className="flex h-(--control) items-center px-3" key={slot}>
					<SkeletonText className="w-24" type="label" />
				</div>
			))}
		</div>
	);
}

export function SettingsContentSkeleton() {
	return (
		<div
			aria-hidden
			className="flex flex-col gap-6"
			data-layout-role="settings-page"
		>
			<div className="flex min-h-(--control-lg) items-center">
				<SkeletonText className="w-40" type="heading" />
			</div>
			<Skeleton className="h-36 w-full rounded-shell" />
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
