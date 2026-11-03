import { BrandLockup } from "#/components/auth/brand-lockup";
import { Card, CardContent } from "#/design-system/ui/card";
import { Skeleton, SkeletonText } from "#/design-system/ui/skeleton";

const CELL_SLOTS = ["a", "b", "c", "d"] as const;

/** Mirrors the login card exactly — same lockup, same 2×2 forge grid, same
 * disclosure row — so nothing reflows when the real buttons land. */
export function LoginPageSkeleton() {
	return (
		<div data-layout-role="login-shell">
			<div aria-hidden data-layout-role="login-content">
				<BrandLockup />

				<div data-layout-role="login-skeleton-header">
					<SkeletonText data-layout-size="wide" type="heading" />
					<SkeletonText data-layout-size="wider" type="body" />
				</div>

				<Card data-layout-role="login-card">
					<CardContent>
						<div data-layout-role="login-skeleton-grid">
							{CELL_SLOTS.map((slot) => (
								<div key={slot}>
									<Skeleton />
								</div>
							))}
						</div>
						<div data-layout-role="login-skeleton-disclosure">
							<Skeleton />
						</div>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
