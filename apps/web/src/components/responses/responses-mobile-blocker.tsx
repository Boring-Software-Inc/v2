import { useRouter } from "@tanstack/react-router";
import { Button } from "@tripwire/ui/button";
import { Drawer } from "@tripwire/ui/drawer";
import {
	EmptyState,
	EmptyStateContent,
	EmptyStateDescription,
	EmptyStateHeader,
	EmptyStateTitle,
} from "#/components/common/empty-state";
import { useCanGoBack } from "#/components/common/history-back-control";
import { MascotArt } from "#/components/mascot/mascot-art";
import { useMediaQuery } from "#/hooks/use-media-query";

const LOCAL_APPEARANCE = {
	node44_1: "pt-4",
	node47_2: "min-h-72 justify-center",
} as const;

export function ResponsesMobileBlocker({
	org,
	repo,
}: {
	org: string;
	repo: string;
}) {
	const router = useRouter();
	const canGoBack = useCanGoBack();
	const mobile = useMediaQuery("(max-width: 1023px)");
	const leave = () => {
		if (canGoBack) {
			router.history.back();
			return;
		}
		void router.navigate({ to: "/$org/$repo", params: { org, repo } });
	};

	return (
		<Drawer
			dismissible={false}
			onOpenChange={() => undefined}
			open={mobile}
			showCloseAction={false}
			showFooter={false}
			showHeader={false}
			side="bottom"
			title="Responses on mobile"
		>
			<div className={LOCAL_APPEARANCE.node44_1}>
				<EmptyState
					art={<MascotArt mood="workflows-empty" />}
					className={LOCAL_APPEARANCE.node47_2}
					variant="plain"
				>
					<EmptyStateHeader>
						<EmptyStateTitle>
							Mobile response builder under construction
						</EmptyStateTitle>
						<EmptyStateDescription>
							We’re tuning this editor for smaller screens. Use Tripwire on
							desktop to build and preview GitHub responses.
						</EmptyStateDescription>
					</EmptyStateHeader>
					<EmptyStateContent>
						<Button onAction={leave}>
							{canGoBack ? "Go back" : "Back to home"}
						</Button>
					</EmptyStateContent>
				</EmptyState>
			</div>
		</Drawer>
	);
}
