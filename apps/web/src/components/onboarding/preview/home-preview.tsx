import { Button } from "@tripwire/ui/button";
import { Add, Icon } from "@tripwire/ui/icon";
import type { ReactNode } from "react";
import {
	EmptyState,
	EmptyStateContent,
	EmptyStateDescription,
	EmptyStateHeader,
	EmptyStateTitle,
} from "#/components/common/empty-state";
import { Page, PageBody, PageHeader } from "#/components/layouts/page";
import { MascotArt } from "#/components/mascot/mascot-art";
import { PreviewApp } from "#/components/onboarding/preview/preview-app";

/**
 * The workspace home before any repo is connected: the same empty state
 * the real home shows an admin.
 */
export function HomePreview({
	org,
	overlay,
}: {
	org: string | null;
	overlay?: ReactNode;
}) {
	return (
		<PreviewApp
			active="home"
			overlay={overlay}
			repo={null}
			url={{
				host: "app.tripwire.sh",
				path: org ? `/${org}/home` : undefined,
			}}
		>
			<Page purpose="task">
				<PageHeader title="Home" />
				<PageBody>
					<EmptyState art={<MascotArt mood="repos-empty" />}>
						<EmptyStateHeader>
							<EmptyStateTitle>No repos yet</EmptyStateTitle>
							<EmptyStateDescription>
								Connect the repos you want Tripwire to check.
							</EmptyStateDescription>
						</EmptyStateHeader>
						<EmptyStateContent>
							<Button size="small" variant="secondary">
								<Icon icon={Add} />
								Connect repos
							</Button>
						</EmptyStateContent>
					</EmptyState>
				</PageBody>
			</Page>
		</PreviewApp>
	);
}
