import type { ReactNode } from "react";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardMeta,
	CardTitle,
} from "#/components/glaze/ui/card";
import { cn } from "#/lib/glaze/utils";

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
	className?: string;
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
	className,
}: EntityCardProps) {
	return (
		<Card
			className={cn(
				"flex h-full flex-col [&>[data-slot=card-panel]]:flex-1",
				className,
			)}
			data-entity-card=""
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
				{status ? <CardAction className="gap-3">{status}</CardAction> : null}
			</CardHeader>
			{children ? (
				<CardContent className="flex-1" flush={flush}>
					{children}
				</CardContent>
			) : null}
			{footerMeta || footerActions ? (
				<CardFooter>
					{footerMeta ? <CardMeta>{footerMeta}</CardMeta> : null}
					{footerActions}
				</CardFooter>
			) : null}
		</Card>
	);
}
