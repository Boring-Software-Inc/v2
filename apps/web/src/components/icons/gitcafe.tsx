import type { SVGProps } from "react";

export function GitCafeIcon(props: SVGProps<SVGSVGElement>) {
	return (
		<svg
			aria-hidden="true"
			data-layout-role="gitcafe-mark"
			viewBox="0 0 14 14"
			xmlns="http://www.w3.org/2000/svg"
			{...props}
		>
			<rect height="14" rx="2" width="14" />
		</svg>
	);
}
