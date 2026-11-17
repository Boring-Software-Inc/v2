import { CopyButton } from "@tripwire/ui/copy-button";
import { Copy, Icon } from "@tripwire/ui/icon";
import { type ReactNode, Suspense, useCallback, useState } from "react";
import { useCodeDark, WrapToggle } from "#/components/code/code-controls";
import { CodeHeader } from "#/components/code/code-header";
import {
	formatLineAnchor,
	type LineRange,
	parseLineAnchor,
} from "#/components/code/line-anchor";
import {
	CodeRendererLoading,
	LazyPierreFile,
} from "#/components/code/pierre-code-loader";
import { cn } from "#/lib/utils";

export interface TripwireCodeFileProps {
	name: string;
	code: string;
	lineAnchors?: boolean;
	actions?: ReactNode;
	className?: string;
}

export function TripwireCodeFile({
	name,
	code,
	lineAnchors = false,
	actions,
	className,
}: TripwireCodeFileProps) {
	const { mounted, dark } = useCodeDark();
	const [wrap, setWrap] = useState(false);
	const [picked, setPicked] = useState<LineRange | null>();
	const selected =
		picked !== undefined
			? picked
			: mounted && lineAnchors
				? parseLineAnchor(window.location.hash)
				: null;
	const select = useCallback((range: LineRange | null) => {
		setPicked(range);
		const { pathname, search } = window.location;
		window.history.replaceState(
			window.history.state,
			"",
			`${pathname}${search}${formatLineAnchor(range)}`,
		);
	}, []);
	return (
		<div
			aria-busy={!mounted ? true : undefined}
			className={cn(
				"code-surface min-w-0 overflow-hidden rounded-lg",
				className,
			)}
			data-slot="tripwire-code-file"
		>
			<CodeHeader name={name}>
				{actions}
				<WrapToggle onWrapChange={setWrap} wrap={wrap} />
				<CopyButton
					ariaLabel={`Copy ${name}`}
					copyLabel="Copy"
					icon={<Icon icon={Copy} />}
					size="small"
					text={code}
					variant="secondary"
				/>
			</CodeHeader>
			{mounted ? (
				<Suspense fallback={<CodeRendererLoading />}>
					<LazyPierreFile
						code={code}
						dark={dark}
						name={name}
						onSelect={lineAnchors ? select : undefined}
						selected={selected}
						wrap={wrap}
					/>
				</Suspense>
			) : (
				<CodeRendererLoading />
			)}
		</div>
	);
}
