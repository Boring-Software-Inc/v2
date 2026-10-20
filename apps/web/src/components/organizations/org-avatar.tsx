import { Avatar } from "#/components/glaze/ui/avatar";

type OrgAvatarSize = "xs" | "sm" | "default" | "lg";

export function OrgAvatar({
	name,
	size = "sm",
	decorative = true,
	className,
}: {
	name: string;
	size?: OrgAvatarSize;
	decorative?: boolean;
	className?: string;
}) {
	return (
		<Avatar
			className={className}
			decorative={decorative}
			name={name || "tripwire"}
			size={size}
		/>
	);
}
