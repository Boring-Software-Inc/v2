import type { ReactNode } from "react";
import {
	Caption,
	SectionHeading,
	Subheading,
	SupportingText,
} from "#/design-system/ui/typography";

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
			data-layout-role="user-sheet-section"
			data-section={id}
			id={`user-sheet-${id}`}
		>
			<header data-layout-role="user-sheet-section-header">
				<SectionHeading id={`user-sheet-${id}-title`} level={3}>
					{title}
				</SectionHeading>
				{action ? (
					<div data-layout-role="user-sheet-section-action">{action}</div>
				) : null}
			</header>
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
		<div data-layout-role="user-sheet-subheading">
			<Subheading level={4}>{title}</Subheading>
			{action ?? (count !== undefined ? <Caption>{count}</Caption> : null)}
		</div>
	);
}

export function FieldRows({ children }: { children: ReactNode }) {
	return <dl data-layout-role="user-sheet-fields">{children}</dl>;
}

export function FieldRow({
	label,
	children,
}: {
	label: ReactNode;
	children: ReactNode;
}) {
	return (
		<div data-layout-role="user-sheet-field">
			<dt>
				<SupportingText as="span">{label}</SupportingText>
			</dt>
			<dd>{children}</dd>
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
		<ul aria-label={label} data-layout-role="user-sheet-list">
			{children}
		</ul>
	);
}

export function ListRow({ children }: { children: ReactNode }) {
	return <li data-layout-role="user-sheet-list-row">{children}</li>;
}

export function QuietLine({ children }: { children: ReactNode }) {
	return <SupportingText>{children}</SupportingText>;
}
