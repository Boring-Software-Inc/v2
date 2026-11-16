import {
	Children,
	type ComponentProps,
	createContext,
	isValidElement,
	type ReactElement,
	useCallback,
	useContext,
	useState,
} from "react";
import { Bot, Globe, Icon } from "./icon";
import { Tooltip } from "./tooltip";

export type AvatarSize = "xs" | "sm" | "default" | "lg";
export type AvatarType = "person" | "agent" | "source";

interface AvatarContextValue {
	name?: string;
	size: AvatarSize;
	type: AvatarType;
}

const AvatarContext = createContext<AvatarContextValue>({
	size: "default",
	type: "person",
});

export interface AvatarProps extends ComponentProps<"span"> {
	decorative?: boolean;
	name?: string;
	size?: AvatarSize;
	src?: string;
	type?: AvatarType;
}

export function Avatar({
	decorative = false,
	name,
	size = "default",
	src,
	type = "person",
	children,
	...props
}: AvatarProps) {
	const labelled = Boolean(name) && !decorative;
	const content = children ?? (
		<>
			{src ? (
				<AvatarImage
					referrerPolicy={type === "source" ? "no-referrer" : undefined}
					src={src}
				/>
			) : null}
			<AvatarFallback />
		</>
	);
	const shared = {
		"data-size": size,
		"data-slot": "avatar",
		"data-type": type,
	} as const;
	const avatar = decorative ? (
		<span {...props} {...shared} aria-hidden="true">
			{content}
		</span>
	) : labelled ? (
		<span {...props} {...shared} aria-label={name} role="img">
			{content}
		</span>
	) : (
		<span {...props} {...shared}>
			{content}
		</span>
	);
	return <AvatarContext value={{ name, size, type }}>{avatar}</AvatarContext>;
}

type AvatarImageProps = Omit<ComponentProps<"img">, "ref">;

export function AvatarImage(props: AvatarImageProps) {
	return (
		<AvatarImageLoad
			key={JSON.stringify([props.src, props.srcSet, props.sizes])}
			{...props}
		/>
	);
}

function AvatarImageLoad({
	alt = "",
	onError,
	onLoad,
	...props
}: AvatarImageProps) {
	const [loaded, setLoaded] = useState(false);
	const attachImage = useCallback((image: HTMLImageElement | null) => {
		if (image?.complete && image.naturalWidth > 0) setLoaded(true);
	}, []);
	return (
		<img
			alt={alt}
			data-slot="avatar-image"
			decoding="async"
			draggable={false}
			{...props}
			ref={attachImage}
			data-loaded={loaded || undefined}
			onError={(event) => {
				setLoaded(false);
				onError?.(event);
			}}
			onLoad={(event) => {
				setLoaded(true);
				onLoad?.(event);
			}}
		/>
	);
}

export function initialsOf(name: string, size: AvatarSize = "default") {
	const clean =
		name.replace(/^(https?:\/\/)?(www\.)?/iu, "").split("@")[0] ?? "";
	const words = clean
		.split(/[\s._\-/]+/u)
		.map((word) => word.match(/[\p{L}\p{N}]/gu)?.join("") ?? "")
		.filter(Boolean);
	if (words.length === 0) return "";
	const first = words[0] ?? "";
	if (size === "xs" || size === "sm") {
		return [...first][0]?.toLocaleUpperCase() ?? "";
	}
	if (words.length === 1) {
		return [...first].slice(0, 2).join("").toLocaleUpperCase();
	}
	return `${[...first][0] ?? ""}${[...(words.at(-1) ?? "")][0] ?? ""}`.toLocaleUpperCase();
}

export function AvatarFallback({ children, ...props }: ComponentProps<"span">) {
	const { name, size, type } = useContext(AvatarContext);
	const glyph = type === "agent" ? Bot : type === "source" ? Globe : null;
	const glyphSize = { xs: 12, sm: 12, default: 14, lg: 16 } as const;
	return (
		<span aria-hidden="true" data-slot="avatar-fallback" {...props}>
			{children ??
				(glyph ? (
					<Icon icon={glyph} size={glyphSize[size]} tone="secondary" />
				) : name ? (
					initialsOf(name, size)
				) : null)}
		</span>
	);
}

export interface AvatarGroupProps extends ComponentProps<"ul"> {
	label?: string;
	max?: number;
	size?: AvatarSize;
}

export function AvatarGroup({
	children,
	label,
	max = 4,
	size = "default",
	...props
}: AvatarGroupProps) {
	const items = Children.toArray(children).filter(
		isValidElement,
	) as ReactElement<{
		name?: string;
	}>[];
	const limit = Number.isFinite(max) ? Math.max(1, Math.floor(max)) : 4;
	const shown = items.length > limit ? items.slice(0, limit - 1) : items;
	const hidden = items.slice(shown.length);
	return (
		<ul aria-label={label} data-size={size} data-slot="avatar-group" {...props}>
			{shown.map((item) => (
				<li data-slot="avatar-group-item" key={item.key}>
					{item}
				</li>
			))}
			{hidden.length > 0 ? (
				<AvatarGroupCount
					names={hidden.flatMap((item) =>
						item.props.name ? [item.props.name] : [],
					)}
					size={size}
				>
					{hidden.length}
				</AvatarGroupCount>
			) : null}
		</ul>
	);
}

export interface AvatarGroupCountProps extends ComponentProps<"li"> {
	names?: string[];
	size?: AvatarSize;
}

export function AvatarGroupCount({
	children,
	names = [],
	size = "default",
	...props
}: AvatarGroupCountProps) {
	const hiddenNames = names.join(", ");
	const content = (
		<>
			<span aria-hidden="true" dir="ltr">
				+{children}
			</span>
			<span className="sr-only">and {children} more</span>
		</>
	);
	return (
		<li data-size={size} data-slot="avatar-group-count" {...props}>
			{hiddenNames ? (
				<Tooltip
					trigger={
						/** biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need the same overflow names as pointer users. */
						<span data-slot="avatar-group-reading" tabIndex={0}>
							{content}
						</span>
					}
				>
					{hiddenNames}
				</Tooltip>
			) : (
				<span data-slot="avatar-group-reading">{content}</span>
			)}
		</li>
	);
}
