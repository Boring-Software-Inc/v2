import type { ComponentPropsWithRef, CSSProperties } from "react";

interface SortableBlockItemProps extends ComponentPropsWithRef<"li"> {
	motionStyle: CSSProperties;
}

export function SortableBlockItem({
	motionStyle,
	ref,
	...props
}: SortableBlockItemProps) {
	return <li ref={ref} style={motionStyle} {...props} />;
}
