import { IconToggle } from "@tripwire/ui/button";
import { Icon, Wrap } from "@tripwire/ui/icon";
import { useTheme } from "next-themes";
import { useHasMounted } from "#/hooks/use-has-mounted";

export interface WrapToggleProps {
	wrap: boolean;
	onWrapChange: (wrap: boolean) => void;
}

export function WrapToggle({ wrap, onWrapChange }: WrapToggleProps) {
	return (
		<span data-layout-role="code-wrap-toggle">
			<IconToggle
				icon={<Icon icon={Wrap} weight={wrap ? "fill" : "regular"} />}
				label="Wrap lines"
				onPressedChange={onWrapChange}
				pressed={wrap}
				size="small"
			/>
		</span>
	);
}

export function useCodeDark() {
	const mounted = useHasMounted();
	const { resolvedTheme } = useTheme();
	return { mounted, dark: mounted && resolvedTheme === "dark" };
}
