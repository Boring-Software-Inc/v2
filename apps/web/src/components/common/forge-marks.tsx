import type { ForgeId } from "@tripwire/contracts";
import type { ReactElement } from "react";
import { GithubIcon } from "#/components/icons/github";

/**
 * Forge brand marks, lifted from the "new login" artboard in Paper. Icon-only —
 * the Paper source draws GitLab and ORIGIN as full lockups (mark + wordmark),
 * but a baked-in wordmark can't take the theme's font or color, so the letters
 * are dropped here and the label is real text in the button.
 *
 * Everything monochrome resolves through `currentColor` so the marks invert with
 * the theme. GitLab keeps its brand oranges (they clear both grounds); OpenGit's
 * cube keeps its three faces as opacity steps rather than fixed greys, which
 * would vanish on a light background.
 *
 * GitHub is NOT redrawn here — Paper carries its own octocat trace, but the app
 * already ships one in `icons/github` used across four surfaces, and two traces
 * of the same brand sitting a row apart in the palette reads as a bug.
 *
 * No explicit size — `Button` normalizes bare svg children to 16px, and every
 * viewBox below is cropped to its mark so they share an optical lane.
 */

type MarkProps = { className?: string };

/**
 * Every forge in the CATALOG mapped to its mark — planned ones included, since
 * they still render in the grids. A `Record<ForgeId, …>` and NOT a switch with a
 * default: there is no sensible fallback mark, and a default arm would quietly
 * brand an unmapped forge as whichever one it points at. Adding a catalog entry
 * breaks this line until a mark exists for it, which is the reminder we want.
 */
const FORGE_MARK = {
	github: GithubIcon,
	gitlab: GitlabMark,
	opengit: OpenGitMark,
	origin: OriginMark,
} satisfies Record<ForgeId, (props: MarkProps) => ReactElement>;

/**
 * The mark for a forge. Every surface that names a forge or a repo goes through
 * here, so adding one is one entry above rather than a hunt for hardcoded
 * octocats.
 */
export function ForgeMark({
	forge,
	className,
}: MarkProps & { forge: ForgeId }) {
	const Mark = FORGE_MARK[forge];
	return <Mark className={className} />;
}

export function OpenGitMark({ className }: MarkProps) {
	return (
		<svg
			aria-hidden="true"
			className={className}
			viewBox="0.49 0 17.019 17"
			xmlns="http://www.w3.org/2000/svg"
		>
			<polygon
				fill="currentColor"
				points="3.596 2.261 7.272 0.051 14.565 4.481 10.889 6.853 5.049 3.22"
			/>
			<polygon
				fill="currentColor"
				fillOpacity="0.72"
				points="10.879 6.853 14.565 4.481 14.565 13.665 10.879 15.918"
			/>
			<polygon
				fill="currentColor"
				fillOpacity="0.9"
				points="3.518 11.455 6.127 9.796 8.962 11.628 8.973 14.84"
			/>
			<polygon
				fill="currentColor"
				fillOpacity="0.55"
				points="3.527 4.558 6.127 6.239 6.127 9.796 3.507 11.445 3.507 11.003"
			/>
		</svg>
	);
}

export function GitlabMark({ className }: MarkProps) {
	return (
		<svg
			aria-hidden="true"
			className={className}
			viewBox="466.677 361.395 12.374 12.115"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path
				d="M479.051 366.176l-0.018-0.046-1.742-4.454c-0.035-0.087-0.098-0.161-0.179-0.21-0.082-0.051-0.177-0.075-0.273-0.071-0.096 0.006-0.188 0.04-0.265 0.098-0.074 0.059-0.129 0.139-0.153 0.231l-1.177 3.527h-4.761l-1.176-3.527c-0.025-0.091-0.08-0.171-0.154-0.231-0.075-0.059-0.167-0.093-0.264-0.098-0.097-0.006-0.193 0.019-0.274 0.071-0.082 0.051-0.144 0.124-0.179 0.21l-1.742 4.454-0.017 0.046c-0.516 1.319-0.077 2.812 1.073 3.663 0.022 0.001 0.04 0.003 0.062 0.004l0.015 0.012 2.655 1.946 1.313 0.974 0.8 0.592c0.193 0.143 0.459 0.143 0.651 0l0.798-0.592 1.313-0.974 2.67-1.958c0.002-0.018 0.005-0.034 0.007-0.005 1.149-0.852 1.589-2.344 1.073-3.662Z"
				fill="#E24329"
			/>
			<path
				d="M479.051 366.176l-0.018-0.046c-0.864 0.173-1.662 0.533-2.342 1.033-0.01 0.008-2.072 1.535-3.827 2.834 1.303 0.966 2.437 1.804 2.437 1.804l2.671-1.958c0.002-0.018 0.005-0.034 0.007-0.005 1.149-0.852 1.589-2.344 1.072-3.662Z"
				fill="#FC6D26"
			/>
			<path
				d="M470.427 371.801l1.313 0.974 0.798 0.592c0.193 0.143 0.459 0.143 0.652 0l0.799-0.592 1.312-0.974s-1.134-0.839-2.437-1.804c-1.303 0.966-2.438 1.804-2.437 1.804Z"
				fill="#FCA326"
			/>
			<path
				d="M469.036 367.163c-0.681-0.5-1.477-0.858-2.342-1.033l-0.017 0.046c-0.516 1.319-0.077 2.812 1.073 3.663 0.022 0.001 0.04 0.003 0.062 0.004l0.015 0.012 2.655 1.946s1.134-0.839 2.438-1.804c-1.755-1.3-3.816-2.827-3.827-2.834Z"
				fill="#FC6D26"
			/>
		</svg>
	);
}

export function OriginMark({ className }: MarkProps) {
	return (
		<svg
			aria-hidden="true"
			className={className}
			viewBox="47.5 299.5 121.4 134.9"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path
				clipRule="evenodd"
				d="M108.192 299.618C110.268 299.515 123.926 308.469 127.051 310.087 131.819 313.274 139.749 315.822 144.222 319.011 150.944 323.803 162.538 328.699 168.278 333.615 168.83 343.346 168.463 356.693 168.469 366.575 168.476 376.629 168.849 390.191 168.251 400.037 165.02 403.347 160.367 405.185 156.239 407.524L131.695 421.116C123.998 425.4 116.379 429.815 108.841 434.358 99.066 430.666 90.317 424.847 81.387 419.737 76.476 416.926 71.143 414.594 66.115 411.665 61.102 408.746 53.066 403.221 47.862 401.397 47.165 389.741 47.757 375.088 47.61 363.114 47.515 355.383 47.22 339.243 48.066 332.388 55.163 329.377 61.585 324.738 68.344 321.199 81.791 314.16 94.357 305.897 108.192 299.618zM54.877 335.106C84.127 335.889 113.692 334.922 142.969 335.267 149.344 335.342 156.786 334.906 163.023 335.731 161.26 340.722 157.527 346.549 154.901 351.289 146.726 366.053 136.478 380.926 128.309 395.665 125.178 401.324 122.36 405.651 119.014 411.059 114.572 418.239 112.713 422.453 107.055 428.871 107.508 408.764 107.21 387.431 107.199 367.201 104.745 364.791 99.488 362.569 96.292 360.766L73.18 347.83C67.613 344.762 62.637 340.651 56.555 338.533 55.606 338.203 54.445 337.961 53.927 337.101 53.898 336.189 54.299 335.835 54.877 335.106z"
				fill="currentColor"
				fillRule="evenodd"
			/>
		</svg>
	);
}
