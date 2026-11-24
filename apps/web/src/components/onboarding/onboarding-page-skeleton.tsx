import { SkeletonText } from "@tripwire/ui/skeleton";
import { BrandLockup } from "#/components/auth/brand-lockup";
import "./onboarding.css";

/** The onboarding column while progress loads: brand, a title, two lines. */
export function OnboardingPageSkeleton() {
	return (
		<div data-layout-role="onboarding-shell">
			<main data-layout-role="onboarding-column">
				<BrandLockup />
				<div data-layout-role="onboarding-stage">
					<section data-layout-role="onboarding-step">
						<header data-layout-role="onboarding-step-header">
							<SkeletonText type="heading" />
							<SkeletonText lines={2} />
						</header>
					</section>
				</div>
			</main>
		</div>
	);
}
