import { TripwireWordmark } from "#/components/common/tripwire-wordmark";
import { Skeleton } from "#/components/ui/skeleton";

/** Mirrors the login card exactly — same lockup, same 2×2 forge grid, same
 * disclosure row — so nothing reflows when the real buttons land. */
export function LoginPageSkeleton() {
	return (
		<div className="flex min-h-dvh flex-col items-center justify-center bg-background p-2">
			<div className="flex flex-1 items-center justify-center self-stretch overflow-clip rounded-lg bg-surface-0 sm:rounded-xl">
				<div className="flex w-[334px] max-w-full shrink-0 flex-col items-center gap-3">
					<div className="flex items-center gap-2 px-1">
						<TripwireWordmark
							className="shrink-0 text-foreground"
							height={20}
							width={32}
						/>
						<span className="font-medium text-foreground text-lg tracking-tight">
							tripwire
						</span>
					</div>

					<div className="flex w-full flex-col gap-1 overflow-clip rounded-[10px] border border-border bg-surface-2 p-0.5">
						<div className="flex flex-col items-start gap-1 px-2 py-1.5">
							<Skeleton className="h-4 w-24" />
							<Skeleton className="h-5 w-52" />
						</div>

						<div className="grid grid-cols-2 gap-1">
							<Skeleton className="h-9 rounded-sm" />
							<Skeleton className="h-9 rounded-sm" />
							<Skeleton className="h-9 rounded-sm" />
							<Skeleton className="h-9 rounded-sm" />
						</div>

						<div className="flex items-center justify-between gap-2 px-3 py-[9px]">
							<Skeleton className="h-4 w-36" />
							<Skeleton className="size-3" />
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
