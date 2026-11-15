import {
	Children,
	type ComponentProps,
	isValidElement,
	type ReactNode,
} from "react";
import { Panel } from "./panel";

function isPart(node: ReactNode, part: typeof CardFooter | typeof Panel) {
	return isValidElement(node) && node.type === part;
}

type SurfaceAttributes<Tag extends "div" | "span" | "a"> = Omit<
	ComponentProps<Tag>,
	"className" | "style" | "color"
>;

export type CardProps = SurfaceAttributes<"div">;

export function Card({ children, ...props }: CardProps) {
	const parts = Children.toArray(children);
	const footer = parts.filter((part) => isPart(part, CardFooter));
	const body = parts.filter((part) => !isPart(part, CardFooter));
	const ownsPanels = body.some((part) => isPart(part, Panel));
	return (
		<div
			className="ui-card"
			data-footer={footer.length > 0 || undefined}
			data-slot="card"
			{...props}
		>
			{ownsPanels ? body : <div data-slot="card-panel">{body}</div>}
			{footer}
		</div>
	);
}

export function CardHeader(props: SurfaceAttributes<"div">) {
	return <div data-slot="card-header" {...props} />;
}

export function CardTitle(props: SurfaceAttributes<"div">) {
	return <div data-slot="card-title" {...props} />;
}

export function CardDescription(props: SurfaceAttributes<"div">) {
	return <div data-slot="card-description" {...props} />;
}

export function CardAction(props: SurfaceAttributes<"div">) {
	return <div data-slot="card-action" {...props} />;
}

export interface CardContentProps extends SurfaceAttributes<"div"> {
	flush?: boolean;
}

export function CardContent({ flush, ...props }: CardContentProps) {
	return (
		<div data-flush={flush || undefined} data-slot="card-content" {...props} />
	);
}

export interface CardFooterProps extends SurfaceAttributes<"div"> {
	wrap?: boolean;
}

export function CardFooter({ wrap, ...props }: CardFooterProps) {
	return (
		<div data-slot="card-footer" data-wrap={wrap || undefined} {...props} />
	);
}

export function CardMeta(props: SurfaceAttributes<"span">) {
	return <span data-slot="card-meta" {...props} />;
}

export function CardLink(props: SurfaceAttributes<"a">) {
	return <a data-control="" data-slot="card-link" {...props} />;
}
