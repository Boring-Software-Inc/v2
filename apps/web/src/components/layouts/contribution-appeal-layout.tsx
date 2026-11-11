import type { ReactNode } from "react";
import { TripwireLogo } from "#/components/common/tripwire-logo";

export function ContributionAppealLayout({
	children,
	loading,
}: {
	children: ReactNode;
	loading?: boolean;
}) {
	return (
		<main
			aria-busy={loading}
			className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center gap-5 px-5 py-10"
		>
			<TripwireLogo size={28} />
			{children}
		</main>
	);
}
