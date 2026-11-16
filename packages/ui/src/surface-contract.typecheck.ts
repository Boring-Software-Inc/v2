import type {
	SkeletonProps,
	SkeletonSwapProps,
	SkeletonTextProps,
} from "./skeleton";
import type { TableCellProps, TableProps } from "./table";

type Absent<T, Key extends PropertyKey> =
	Extract<keyof T, Key> extends never ? true : false;

export const skeletonFill: SkeletonProps = { fill: true };
export const skeletonChromeIsPrivate: Absent<
	SkeletonProps,
	"className" | "style" | "width" | "height"
> = true;
export const skeletonTextChromeIsPrivate: Absent<
	SkeletonTextProps,
	"className" | "style" | "last"
> = true;
export const skeletonSwapChromeIsPrivate: Absent<
	SkeletonSwapProps,
	"className" | "style"
> = true;
export const tableChromeIsPrivate: Absent<
	TableProps,
	"className" | "style" | "containerClassName" | "frameClassName" | "maxHeight"
> = true;
export const cellChromeIsPrivate: Absent<
	TableCellProps,
	"className" | "style"
> = true;
