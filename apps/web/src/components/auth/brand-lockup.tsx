import { UI_MOTION } from "@tripwire/ui/motion";
import { motion } from "motion/react";
import { TripwireWordmark } from "#/components/common/tripwire-wordmark";
import { siteConfig } from "#/lib/site-config";

export function BrandLockup({
	markLayoutId,
}: {
	/** Shares the mark with another one on screen, so it can travel into place. */
	markLayoutId?: string;
} = {}) {
	return (
		<div data-layout-role="brand-lockup">
			<motion.span
				aria-hidden
				layoutId={markLayoutId}
				transition={{ layout: UI_MOTION.track }}
			>
				<TripwireWordmark height={18} width={28} />
			</motion.span>
			<span>{siteConfig.name}</span>
		</div>
	);
}
