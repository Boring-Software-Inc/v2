import { lazy, type ReactNode, Suspense, useState } from "react";
import { useCodeDark, WrapToggle } from "#/components/code/code-controls";
import { PlainCode } from "#/components/code/plain-code";
import { CopyButton } from "#/components/glaze/ui/copy-button";
import {
	SegmentedControl,
	SegmentedControlItem,
} from "#/components/glaze/ui/segmented-control";
import { cn } from "#/lib/glaze/utils";

const PierreDiff = lazy(() =>
	import("#/components/code/pierre-code").then((module) => ({
		default: module.PierreDiff,
	})),
);

export type CodeDiffLayout = "unified" | "split";

export interface TripwireCodeDiffProps {
	name: string;
	before: string;
	after: string;
	layout?: CodeDiffLayout;
	actions?: ReactNode;
	className?: string;
}

export function TripwireCodeDiff({
	name,
	before,
	after,
	layout = "unified",
	actions,
	className,
}: TripwireCodeDiffProps) {
	const { mounted, dark } = useCodeDark();
	const [wrap, setWrap] = useState(false);
	const [shown, setShown] = useState<CodeDiffLayout>(layout);
	const header = (
		<div className="flex items-center gap-1">
			{actions}
			<SegmentedControl
				aria-label="Diff layout"
				className="max-sm:hidden"
				onValueChange={(next) => {
					if (next === "unified" || next === "split") {
						setShown(next);
					}
				}}
				size="sm"
				value={shown}
			>
				<SegmentedControlItem value="unified">Unified</SegmentedControlItem>
				<SegmentedControlItem value="split">Split</SegmentedControlItem>
			</SegmentedControl>
			<WrapToggle onWrapChange={setWrap} wrap={wrap} />
			<CopyButton label={name} showLabel value={after} variant="secondary" />
		</div>
	);
	return (
		<div
			className={cn(
				"min-w-0 overflow-hidden rounded-lg border border-line-faint bg-code-surface",
				className,
			)}
			data-slot="tripwire-code-diff"
		>
			{mounted ? (
				<Suspense
					fallback={<PlainCode code={after} header={header} name={name} />}
				>
					<PierreDiff
						after={after}
						before={before}
						dark={dark}
						header={header}
						name={name}
						split={shown === "split"}
						wrap={wrap}
					/>
				</Suspense>
			) : (
				<PlainCode code={after} header={header} name={name} />
			)}
		</div>
	);
}
