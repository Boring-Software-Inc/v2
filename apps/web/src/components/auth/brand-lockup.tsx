import { TripwireWordmark } from "#/components/common/tripwire-wordmark";
import { siteConfig } from "#/lib/site-config";

export function BrandLockup() {
	return (
		<div className="flex items-center gap-2 text-text-1">
			<TripwireWordmark className="shrink-0" height={18} width={28} />
			<span className="type-heading-sm tracking-heading">
				{siteConfig.name}
			</span>
		</div>
	);
}
