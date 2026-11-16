import type { ComponentProps } from "react";

const keyAliases = new Map([
	["Alt", "⌥"],
	["Control", "Ctrl"],
	["Enter", "↵"],
	["Meta", "⌘"],
	["Shift", "⇧"],
]);

export interface KbdProps extends ComponentProps<"kbd"> {
	keyName?: string;
}

export function Kbd({ children, keyName, ...props }: KbdProps) {
	const value = keyName ? (keyAliases.get(keyName) ?? keyName) : children;
	return (
		<kbd data-slot="kbd" {...props}>
			{value}
		</kbd>
	);
}

export function KbdGroup(props: ComponentProps<"span">) {
	return <span data-slot="kbd-group" {...props} />;
}

export function shortcut(...keys: string[]) {
	return keys.map((key) => keyAliases.get(key) ?? key).join(" ");
}
