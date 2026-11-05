import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";

type SemanticProps<T extends ElementType> = Omit<
	ComponentPropsWithoutRef<T>,
	"children" | "className" | "style" | "color"
> & {
	children: ReactNode;
};

export function PageTitle(props: SemanticProps<"h1">) {
	return <h1 data-type-role="page-title" {...props} />;
}

export function SectionHeading({
	level = 2,
	...props
}: SemanticProps<"h2"> & { level?: 2 | 3 }) {
	const Heading = level === 2 ? "h2" : "h3";
	return <Heading data-type-role="section-heading" {...props} />;
}

export function Subheading({
	level = 3,
	...props
}: SemanticProps<"h3"> & { level?: 3 | 4 }) {
	const Heading = level === 3 ? "h3" : "h4";
	return <Heading data-type-role="subheading" {...props} />;
}

export function Body({
	as: Component = "p",
	...props
}: SemanticProps<"p"> & { as?: "p" | "span" }) {
	return <Component data-type-role="body" {...props} />;
}

export function SupportingText({
	as: Component = "p",
	...props
}: SemanticProps<"p"> & { as?: "p" | "span" }) {
	return <Component data-type-role="supporting-text" {...props} />;
}

export function Label({
	as: Component = "span",
	...props
}: SemanticProps<"span"> & { as?: "span" | "div" }) {
	return <Component data-type-role="label" {...props} />;
}

export function Caption({
	as: Component = "span",
	...props
}: SemanticProps<"span"> & { as?: "span" | "time" }) {
	return <Component data-type-role="caption" {...props} />;
}

export function CodeText({
	as: Component = "code",
	...props
}: SemanticProps<"code"> & { as?: "code" | "span" }) {
	return <Component data-type-role="code-text" {...props} />;
}

export function DataValue({
	as: Component = "span",
	...props
}: SemanticProps<"span"> & { as?: "span" | "output" | "dd" }) {
	return <Component data-type-role="data-value" {...props} />;
}
