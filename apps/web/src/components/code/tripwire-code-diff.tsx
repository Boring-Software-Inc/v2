import { IconButton } from "@tripwire/ui/button";
import { CopyButton } from "@tripwire/ui/copy-button";
import { ChevronDown, ChevronRight, Copy, Icon } from "@tripwire/ui/icon";
import { SegmentedControl } from "@tripwire/ui/radio-group";
import { lazy, type ReactNode, Suspense, useId, useState } from "react";
import { useCodeDark, WrapToggle } from "#/components/code/code-controls";
import { CodeHeader, type DiffStats } from "#/components/code/code-header";
import { PlainCode } from "#/components/code/plain-code";
import { useMediaQuery } from "#/hooks/use-media-query";
import { cn } from "#/lib/utils";
import "./tripwire-code-diff.css";

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
	review?: boolean;
}

export function TripwireCodeDiff({
	name,
	before,
	after,
	layout = "unified",
	actions,
	className,
	review = false,
}: TripwireCodeDiffProps) {
	const { mounted, dark } = useCodeDark();
	const [wrap, setWrap] = useState(false);
	const [shown, setShown] = useState<CodeDiffLayout>(layout);
	const [expanded, setExpanded] = useState(true);
	const contentId = useId();
	const narrow = useMediaQuery("(max-width: 639.98px)");
	const header = (stats?: DiffStats) => (
		<CodeHeader
			className={review ? "sticky top-0 z-10 bg-code-surface" : undefined}
			leading={
				review ? (
					<IconButton
						aria-controls={contentId}
						aria-expanded={expanded}
						icon={<Icon icon={expanded ? ChevronDown : ChevronRight} />}
						label={`${expanded ? "Collapse" : "Expand"} ${name} diff`}
						onAction={() => setExpanded(!expanded)}
						size="small"
						type="button"
						variant="ghost"
					/>
				) : undefined
			}
			name={name}
			stats={stats}
		>
			{actions}
			<div className="max-sm:hidden">
				<SegmentedControl
					ariaLabel="Diff layout"
					onValueChange={(next) => {
						if (next === "unified" || next === "split") {
							setShown(next);
						}
					}}
					options={[
						{ label: "Unified", value: "unified" },
						{ label: "Split", value: "split" },
					]}
					size="small"
					value={shown}
				/>
			</div>
			<WrapToggle onWrapChange={setWrap} wrap={wrap} />
			<span data-layout-role="code-diff-copy">
				<CopyButton
					ariaLabel={`Copy ${name}`}
					copyLabel="Copy"
					icon={<Icon icon={Copy} />}
					size="small"
					text={after}
					variant="secondary"
				/>
			</span>
		</CodeHeader>
	);
	const plain = (
		<>
			{header()}
			<div hidden={!expanded} id={contentId}>
				<PlainCode code={after} />
			</div>
		</>
	);
	return (
		<div
			className={cn(
				"code-surface min-w-0 rounded-lg",
				review ? "overflow-clip rounded-shell" : "overflow-hidden",
				className,
			)}
			data-slot="tripwire-code-diff"
			data-review-diff={
				review ? (expanded ? "expanded" : "collapsed") : undefined
			}
		>
			{mounted ? (
				<Suspense fallback={plain}>
					<PierreDiff
						after={after}
						before={before}
						dark={dark}
						contentId={contentId}
						hidden={!expanded}
						name={name}
						renderHeader={header}
						split={!narrow && shown === "split"}
						wrap={wrap}
					/>
				</Suspense>
			) : (
				plain
			)}
		</div>
	);
}
