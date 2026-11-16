import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardMeta,
	CardTitle,
} from "@tripwire/ui/card";
import type { ReactNode } from "react";

export interface EntityCardProps {
	title: ReactNode;
	description?: ReactNode;
	badges?: ReactNode;
	status?: ReactNode;
	children?: ReactNode;
	footerMeta?: ReactNode;
	footerActions?: ReactNode;
	selected?: boolean;
	flush?: boolean;
	footerLayout?: "default" | "workflow";
	feedbackName?: string;
}

export function EntityCard({
	title,
	description,
	badges,
	status,
	children,
	footerMeta,
	footerActions,
	selected,
	flush,
	footerLayout = "default",
	feedbackName = "EntityCard",
}: EntityCardProps) {
	return (
		<Card
			data-entity-card=""
			data-footer-layout={footerLayout}
			data-feedback-name={feedbackName}
			data-selected={selected ? "" : undefined}
		>
			<CardHeader>
				<CardTitle>{title}</CardTitle>
				{description ? <CardDescription>{description}</CardDescription> : null}
				{badges ? (
					<div className="col-start-1 flex flex-wrap items-center gap-1">
						{badges}
					</div>
				) : null}
				{status ? <CardAction>{status}</CardAction> : null}
			</CardHeader>
			{children ? <CardContent flush={flush}>{children}</CardContent> : null}
			{footerMeta || footerActions ? (
				<CardFooter wrap={footerLayout === "workflow"}>
					{footerMeta ? <CardMeta>{footerMeta}</CardMeta> : null}
					{footerActions}
				</CardFooter>
			) : null}
		</Card>
	);
}
