import { cn } from "#/lib/glaze/utils";

export function StepDoneMark({
	size = 20,
	className,
}: {
	size?: 16 | 20;
	className?: string;
}) {
	return (
		<svg
			aria-label="Done"
			className={cn("shrink-0", className)}
			height={size}
			role="img"
			viewBox="0 0 20 20"
			width={size}
		>
			<circle className="fill-ok" cx="10" cy="10" r="9" />
			<path
				className="stroke-text-inverse"
				d="M6 10.2l2.7 2.6L14 7.5"
				fill="none"
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="1.8"
			/>
		</svg>
	);
}
