import type { ReactNode } from "react";

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
				<div className="flex min-w-0 flex-col gap-6">{children}</div>
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
	return (
		<header className="flex min-h-(--control-lg) flex-wrap items-center justify-between gap-3">
			<h1 className="type-title">{title}</h1>
			{children ? (
				<div className="flex items-center gap-2">{children}</div>
			) : null}
		</header>
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
	const headingId = `${id}-heading`;
	return (
		<section
			aria-labelledby={headingId}
			className="flex scroll-mt-6 flex-col gap-3"
			id={id}
		>
			<div className="flex min-h-(--control) items-center justify-between gap-3">
				<h2 className="type-heading-sm" id={headingId}>
					{title}
				</h2>
				{action}
			</div>
			{children}
		</section>
	);
}

export function SettingsCard({ children }: { children: ReactNode }) {
	return <div className="shell">{children}</div>;
}
