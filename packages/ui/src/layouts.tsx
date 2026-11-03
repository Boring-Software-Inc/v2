import {
	type ComponentPropsWithoutRef,
	createContext,
	type ReactNode,
	useContext,
} from "react";
import { PageTitle, SectionHeading, SupportingText } from "./typography";

interface PageProps {
	children: ReactNode;
	purpose?: "overview" | "task";
}

interface PageHeaderProps {
	title: string;
	description?: string;
	actions?: ReactNode;
}

interface SectionContextValue {
	headingId: string;
}

interface SectionProps {
	id: string;
	children: ReactNode;
}

interface SectionHeaderProps {
	title: string;
	description?: string;
	actions?: ReactNode;
}

interface ActionRowProps {
	secondary?: ReactNode;
	primary: ReactNode;
}

type FormSectionProps = Omit<
	ComponentPropsWithoutRef<"form">,
	"children" | "className" | "style"
> & {
	children: ReactNode;
};

const SectionContext = createContext<SectionContextValue | null>(null);

function useSectionContext() {
	const context = useContext(SectionContext);
	if (!context) {
		throw new Error("SectionHeader must be rendered inside Section");
	}
	return context;
}

export function Page({ children, purpose = "overview" }: PageProps) {
	return (
		<div data-layout-purpose={purpose} data-layout-role="page">
			{children}
		</div>
	);
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
	return (
		<header data-layout-role="page-header">
			<div>
				<PageTitle>{title}</PageTitle>
				{description ? (
					<div>
						<SupportingText>{description}</SupportingText>
					</div>
				) : null}
			</div>
			{actions ? <div>{actions}</div> : null}
		</header>
	);
}

export function PageBody({ children }: PageProps) {
	return <div data-layout-role="page-body">{children}</div>;
}

export function Section({ id, children }: SectionProps) {
	const headingId = `${id}-heading`;
	return (
		<SectionContext.Provider value={{ headingId }}>
			<section aria-labelledby={headingId} data-layout-role="section" id={id}>
				{children}
			</section>
		</SectionContext.Provider>
	);
}

export function SectionHeader({
	title,
	description,
	actions,
}: SectionHeaderProps) {
	const { headingId } = useSectionContext();
	return (
		<header data-layout-role="section-header">
			<div>
				<SectionHeading id={headingId}>{title}</SectionHeading>
				{description ? (
					<div>
						<SupportingText>{description}</SupportingText>
					</div>
				) : null}
			</div>
			{actions ? <div>{actions}</div> : null}
		</header>
	);
}

export function SectionBody({ children }: { children: ReactNode }) {
	return <div data-layout-role="section-body">{children}</div>;
}

export function ActionRow({ secondary, primary }: ActionRowProps) {
	return (
		<div data-layout-role="action-row">
			{secondary}
			{primary}
		</div>
	);
}

export function FormSection({ children, ...props }: FormSectionProps) {
	return (
		<form data-layout-role="form-section" {...props}>
			{children}
		</form>
	);
}

export function FormActions({ secondary, primary }: ActionRowProps) {
	return (
		<div data-layout-role="form-actions">
			{secondary}
			{primary}
		</div>
	);
}
