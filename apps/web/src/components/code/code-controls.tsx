import { useTheme } from "next-themes";
import { Icon, Wrap } from "#/design-system/icon";
import { Button } from "#/design-system/ui/button";
import { useHasMounted } from "#/hooks/use-has-mounted";

export interface WrapToggleProps {
	wrap: boolean;
	onWrapChange: (wrap: boolean) => void;
}

export function WrapToggle({ wrap, onWrapChange }: WrapToggleProps) {
	return (
		<Button
			aria-label="Wrap lines"
			aria-pressed={wrap}
			className="text-text-2 aria-pressed:text-text-1"
			onClick={() => onWrapChange(!wrap)}
			size="icon-sm"
			variant="ghost"
		>
			<Icon icon={Wrap} weight={wrap ? "fill" : "regular"} />
		</Button>
	);
}

export function useCodeDark() {
	const mounted = useHasMounted();
	const { resolvedTheme } = useTheme();
	return { mounted, dark: mounted && resolvedTheme === "dark" };
}
