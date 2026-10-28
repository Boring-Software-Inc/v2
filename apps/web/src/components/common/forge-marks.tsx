import type { ForgeId } from "@tripwire/contracts";
import type { ReactElement } from "react";
import { GithubIcon } from "#/components/icons/github";

/**
 * Forge brand marks, lifted from the "new login" artboard in Paper. Icon-only —
 * the Paper source draws GitLab as a full lockup (mark + wordmark),
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
 * Every forge in the CATALOG mapped to its mark, planned ones included. A
 * `Record<ForgeId, …>` and NOT a switch with a
 * default: there is no sensible fallback mark, and a default arm would quietly
 * brand an unmapped forge as whichever one it points at. Adding a catalog entry
 * breaks this line until a mark exists for it, which is the reminder we want.
 */
const FORGE_MARK = {
	github: GithubIcon,
	gitlab: GitlabMark,
	opengit: OpenGitMark,
	gitcafe: GitCafeMark,
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
				fill="currentColor"
			/>
			<path
				d="M479.051 366.176l-0.018-0.046c-0.864 0.173-1.662 0.533-2.342 1.033-0.01 0.008-2.072 1.535-3.827 2.834 1.303 0.966 2.437 1.804 2.437 1.804l2.671-1.958c0.002-0.018 0.005-0.034 0.007-0.005 1.149-0.852 1.589-2.344 1.072-3.662Z"
				fill="currentColor"
				fillOpacity={0.7}
			/>
			<path
				d="M470.427 371.801l1.313 0.974 0.798 0.592c0.193 0.143 0.459 0.143 0.652 0l0.799-0.592 1.312-0.974s-1.134-0.839-2.437-1.804c-1.303 0.966-2.438 1.804-2.437 1.804Z"
				fill="currentColor"
				fillOpacity={0.45}
			/>
			<path
				d="M469.036 367.163c-0.681-0.5-1.477-0.858-2.342-1.033l-0.017 0.046c-0.516 1.319-0.077 2.812 1.073 3.663 0.022 0.001 0.04 0.003 0.062 0.004l0.015 0.012 2.655 1.946s1.134-0.839 2.438-1.804c-1.755-1.3-3.816-2.827-3.827-2.834Z"
				fill="currentColor"
				fillOpacity={0.7}
			/>
		</svg>
	);
}

export function GitCafeMark({ className }: MarkProps) {
	return (
		<svg
			aria-hidden="true"
			className={className}
			viewBox="0 0 14 14"
			xmlns="http://www.w3.org/2000/svg"
		>
			<rect fill="var(--brand-gitcafe)" height="14" rx="2" width="14" />
		</svg>
	);
}
