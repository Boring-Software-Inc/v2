import { Copy01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { Button } from "#/components/ui/button";
import { toast } from "#/components/ui/toast";
import { formatEscapeLabel } from "#/lib/webview";
import { webviewHostQueryOptions } from "#/lib/webview.query";

/** The design's filled warning triangle. Hugeicons free ships stroke-only. */
function WarningIcon() {
	return (
		<svg
			aria-hidden="true"
			className="size-[13px] shrink-0 text-[#ceb705]"
			fill="currentColor"
			viewBox="341.334 0 369.777 369.777"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path d="M396.052 334.789C378.301 335.633 361.334 319.694 361.276 301.443 361.229 287.09 364.386 283.314 371.305 271.029L381.364 253.11 416.503 190.76 465.503 103.675 481.343 75.521C489.547 60.683 498.646 39.467 517.069 35.948 533.39 32.829 549.588 38.227 558.506 52.775 563.36 60.692 567.546 68.838 572.091 76.927L598.448 123.676 663.956 240.137 677.906 264.807C681.434 271.06 689.36 283.715 690.345 290.132 692.029 301.125 691.752 310.024 685.411 319.316L684.42 319.314C683.239 320.658 678.991 325.504 677.697 326.353L677.38 326.267 677.819 325.057C676.769 324.961 667.561 331.306 665.705 332.195 665.299 332.39 661.861 332.446 661.226 332.463L661.147 332.762 662.333 333.11C660.499 333.502 659.583 333.312 657.872 333.501 656.617 333.639 654.752 334.437 653.369 334.475 647.167 334.645 640.753 334.579 634.55 334.581L605.631 334.587 456.969 334.592 415.687 334.582C412.322 334.578 398.888 334.331 396.052 334.789zM511.481 206.307C516.757 211.911 518.631 215.137 526.693 215.382 527.001 215.391 527.308 215.395 527.616 215.392 533.018 215.158 533.564 214.018 537.724 210.195 538.773 209.093 540.718 206.505 540.86 204.97 541.686 196.011 542.274 185.03 541.735 176.038 540.993 163.617 543.318 143.645 540.573 131.944 535.632 126.756 533.149 123.292 525.305 123.997 518.797 124.577 512.404 128.59 511.414 135.523 509.912 146.036 510.991 157.232 510.664 167.868 510.81 178.722 510.132 193.045 511.142 203.378 511.231 204.357 511.343 205.334 511.481 206.307zM511.226 264.267C514.352 266.302 514.964 267.589 516.875 270.697 520.468 272.249 524.041 272.903 527.97 272.843 530.535 272.512 532.369 272.215 534.89 271.655 539.045 265.297 542.71 264.375 541.214 254.715 540.645 251.049 537.568 247.363 534.426 245.408 531.568 243.621 528.249 242.713 524.88 242.796 512.669 246.344 510.489 252.405 511.226 264.267z" />
		</svg>
	);
}

/**
 * Shown only inside an embedded browser (the X app and friends), where the
 * OAuth hop is likely to dead-end. Copy is the whole mechanism: the host app
 * owns navigation, so nothing we can call reliably hands the url to a real
 * browser. Detection is SSR'd off the request header.
 */
export function WebviewNotice() {
	const { data } = useQuery(webviewHostQueryOptions());
	const path = useRouterState({ select: (state) => state.location.href });

	if (!data?.host) {
		return null;
	}

	// Absolute, and built without `window` so the SSR pass renders the same card.
	const href = `${data.origin}${path}`;

	const onCopy = () => {
		navigator.clipboard?.writeText(href);
		toast({
			title: "copied to clipboard",
			body: "Paste the link into your browser to continue.",
			status: "success",
			action: { label: "close", onClick: () => {} },
		});
	};

	return (
		<div className="flex w-[334px] max-w-full shrink-0 flex-col items-end justify-center gap-2 rounded-[10px] border border-border bg-surface-2 p-2">
			<div className="flex flex-col items-start gap-2 self-stretch px-1">
				<div className="flex items-center gap-1.5">
					<WarningIcon />
					<span className="shrink-0 text-[13px] text-muted-foreground leading-4">
						Heads up
					</span>
				</div>
				<p className="self-stretch text-pretty text-foreground text-xs leading-4">
					Logging in with the above methods may not work in your browser. Copy
					the link below to continue in a supported browser
				</p>
			</div>

			<div className="flex flex-col items-end gap-1.5 self-stretch">
				<button
					aria-label="copy the login link"
					className="flex h-7 shrink-0 items-center gap-2 self-stretch overflow-clip rounded-md bg-surface-1 px-2.5 py-1 text-left"
					onClick={onCopy}
					type="button"
				>
					<span className="line-clamp-1 min-w-0 flex-1 font-medium text-muted-foreground text-xs leading-4">
						{formatEscapeLabel(href)}
					</span>
					<HugeiconsIcon
						className="shrink-0 text-muted-foreground"
						icon={Copy01Icon}
						size={11}
						strokeWidth={2}
					/>
				</button>

				<Button
					className="h-6 max-w-60 min-w-0 gap-2 rounded-sm bg-surface-0 px-1.5 py-1 text-[11px]/[1.5] text-foreground hover:bg-secondary"
					iconRight={
						<HugeiconsIcon
							className="text-muted-foreground"
							icon={Copy01Icon}
							size={11}
							strokeWidth={2}
						/>
					}
					onClick={onCopy}
				>
					Copy link
				</Button>
			</div>
		</div>
	);
}
