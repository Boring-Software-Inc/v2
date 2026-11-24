import { Check, GithubMark, Icon } from "@tripwire/ui/icon";
import { BrandLockup } from "#/components/auth/brand-lockup";
import { TripwireWordmark } from "#/components/common/tripwire-wordmark";
import { MascotArt } from "#/components/mascot/mascot-art";
import { PreviewWindow } from "#/components/onboarding/preview/preview-window";
import { InstallSetupHeader } from "#/components/organizations/install-setup-shell";

const FORGE_HOST = {
	github: "github.com",
	gitcafe: "git.cafe",
} satisfies Record<"github" | "gitcafe", string>;

/**
 * The forge's own install page in the other tab, as the user sees it there:
 * the app, their org, which repos and what it can do. The layout follows
 * GitHub's install screen; the colors stay Tripwire's so both themes read.
 */
export function GithubInstallPreview({
	forge,
	org,
}: {
	forge: "github" | "gitcafe";
	org: string;
}) {
	return (
		<PreviewWindow
			url={{
				host: FORGE_HOST[forge],
				path: "/apps/tripwire/installations/new",
			}}
		>
			<div data-layout-role="onboarding-forge-page">
				<header data-part="bar">
					<Icon icon={GithubMark} size={32} />
				</header>
				<div data-part="body">
					<span data-part="app">
						<TripwireWordmark height={30} width={46} />
					</span>
					<h2 data-part="title">Install Tripwire</h2>
					<p data-part="sub">
						Install on your organization <strong>{org}</strong>
					</p>
					<div data-part="box">
						<div data-part="section">
							<strong>for these repositories:</strong>
							<span data-part="option" data-checked="true">
								<span data-part="radio" />
								<span>
									<strong>All repositories</strong>
									<span data-part="hint">
										This applies to all current and future repositories owned by
										the resource owner. Also includes public repositories
										(read-only).
									</span>
								</span>
							</span>
							<span data-part="option">
								<span data-part="radio" />
								<span>
									<strong>Only select repositories</strong>
									<span data-part="hint">
										Select at least one repository. Also includes public
										repositories (read-only).
									</span>
								</span>
							</span>
						</div>
						<div data-part="section">
							<strong>with these permissions:</strong>
							<span data-part="permission">
								<Icon icon={Check} size={14} />
								<span>
									<strong>Read</strong> access to members and metadata
								</span>
							</span>
							<span data-part="permission">
								<Icon icon={Check} size={14} />
								<span>
									<strong>Read</strong> and <strong>write</strong> access to
									checks, issues, and pull requests
								</span>
							</span>
						</div>
					</div>
					<div data-part="actions">
						<span data-part="install">Install</span>
						<span data-part="cancel">Cancel</span>
					</div>
					<p data-part="next">
						Next: you'll be redirected to https://app.tripwire.sh/install/setup
					</p>
				</div>
			</div>
		</PreviewWindow>
	);
}

/** Tripwire's install callback while the installation links to the workspace. */
export function ConnectingPreview() {
	return (
		<PreviewWindow url={{ host: "app.tripwire.sh", path: "/install/setup" }}>
			<div data-layout-role="onboarding-connecting-page">
				<BrandLockup />
				<MascotArt mood="repos-syncing" />
				<InstallSetupHeader title="Connecting your installation…" />
			</div>
		</PreviewWindow>
	);
}
