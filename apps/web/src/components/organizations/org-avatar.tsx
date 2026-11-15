import { DitherAvatar } from "#/components/dither/dither-avatar";
import { cn } from "#/lib/utils";

type OrgAvatarSize = "xs" | "sm" | "default" | "lg" | "xl";

export function OrgAvatar({
	name,
	hue,
	size = "sm",
	animate = false,
	replayToken,
	decorative = true,
	className,
}: {
	name: string;
	hue?: number | null;
	size?: OrgAvatarSize;
	animate?: boolean;
	replayToken?: number;
	decorative?: boolean;
	className?: string;
}) {
	const seed = name || "tripwire";
	return (
		<DitherAvatar
			animate={animate}
			className={cn(
				"rounded-pill",
				size === "xs" && "size-5",
				size === "sm" && "size-6",
				size === "default" && "size-8",
				size === "lg" && "size-10",
				size === "xl" && "size-12 rounded-panel",
				"overflow-hidden bg-field",
				className,
			)}
			hue={hue ?? undefined}
			label={decorative ? undefined : `${seed} avatar`}
			name={seed}
			replayToken={replayToken}
		/>
	);
}
