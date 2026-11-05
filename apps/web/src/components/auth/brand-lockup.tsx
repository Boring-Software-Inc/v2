import { TripwireWordmark } from "#/components/common/tripwire-wordmark";
import { siteConfig } from "#/lib/site-config";

export function BrandLockup() {
	return (
		<div data-layout-role="brand-lockup">
			<span aria-hidden>
				<TripwireWordmark height={18} width={28} />
			</span>
			<span>{siteConfig.name}</span>
		</div>
	);
}
