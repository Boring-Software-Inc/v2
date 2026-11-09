import { useHydrated, useRouter, useRouterState } from "@tanstack/react-router";
import { ArrowLeft, Icon } from "#/design-system/icon";

interface HistoryBackControlProps {
	label?: string;
}

export function useCanGoBack() {
	const hydrated = useHydrated();
	const router = useRouter();
	const canGoBack = useRouterState({
		select: () => router.history.canGoBack(),
	});
	return hydrated && canGoBack;
}

export function HistoryBackControl({
	label = "Back",
}: HistoryBackControlProps) {
	const router = useRouter();
	const canGoBack = useCanGoBack();

	if (!canGoBack) {
		return null;
	}

	return (
		<button
			aria-label={label}
			data-layout-role="history-back-control"
			onClick={() => router.history.back()}
			type="button"
		>
			<Icon icon={ArrowLeft} />
			<span data-layout-role="history-back-label">{label}</span>
		</button>
	);
}
