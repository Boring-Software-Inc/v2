import type { ReactNode } from "react";

export function SectionHeading({
	id,
	title,
	description,
}: {
	id: string;
	title: string;
	description?: ReactNode;
}) {
	return (
		<div className="flex flex-col gap-0.5">
			<h3 className="type-heading-sm" id={id}>
				{title}
			</h3>
			{description ? (
				<p className="type-body-sm text-text-2">{description}</p>
			) : null}
		</div>
	);
}
