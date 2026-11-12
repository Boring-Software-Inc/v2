import type { ReactNode } from "react";
import { TripwireLogo } from "#/components/common/tripwire-logo";

export function ContributionAppealLayout({
	children,
	headerAction,
	loading,
	wide = false,
}: {
	children: ReactNode;
	headerAction?: ReactNode;
	loading?: boolean;
	wide?: boolean;
}) {
	return (
		<main
			aria-busy={loading}
			className={`mx-auto flex min-h-dvh w-full flex-col gap-6 px-5 py-8 sm:px-8 sm:py-10 ${wide ? "max-w-5xl" : "max-w-3xl"}`}
		>
			<div className="flex min-h-7 items-center justify-between gap-3">
				<TripwireLogo size={28} />
				{headerAction}
			</div>
			{children}
		</main>
	);
}
