import { DitherAvatar } from "#/components/dither/dither-avatar";
import { avatarVariants } from "#/components/glaze/ui/avatar";
import { cn } from "#/lib/glaze/utils";

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
				size === "xl"
					? cn(
							avatarVariants({ size: "lg", type: "source" }),
							"size-12 rounded-panel",
						)
					: avatarVariants({ size, type: "source" }),
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
