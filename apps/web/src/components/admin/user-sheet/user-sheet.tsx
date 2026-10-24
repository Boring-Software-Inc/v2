import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { AccessSection } from "#/components/admin/user-sheet/access-section";
import { AccountSection } from "#/components/admin/user-sheet/account-section";
import { ActivitySection } from "#/components/admin/user-sheet/activity-section";
import {
	DangerSection,
	DeleteUserDialog,
} from "#/components/admin/user-sheet/danger-section";
import { DetailsRail } from "#/components/admin/user-sheet/details-rail";
import { FlagsSection } from "#/components/admin/user-sheet/flags-section";
import { ModerationSection } from "#/components/admin/user-sheet/moderation-section";
import { QuietLine } from "#/components/admin/user-sheet/sheet-parts";
import { useActiveSection } from "#/components/admin/user-sheet/use-active-section";
import { UserSheetHeader } from "#/components/admin/user-sheet/user-sheet-header";
import { UserSheetSkeleton } from "#/components/admin/user-sheet/user-sheet-skeleton";
import { ChevronDown, ChevronUp, Close, Icon } from "#/components/glaze/icon";
import { Button } from "#/components/glaze/ui/button";
import {
	Sheet,
	SheetClose,
	SheetContent,
	SheetTitle,
} from "#/components/glaze/ui/sheet";
import {
	SHEET_SECTIONS,
	type SheetPosition,
	type SheetSectionId,
	type SheetStep,
} from "#/lib/admin-user-sheet";
import { cn } from "#/lib/glaze/utils";
import type { AdminUserView } from "#/lib/staff-users.functions";
import { adminUserQueryOptions } from "#/lib/staff-users.query";

function prefersReducedMotion(): boolean {
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function SheetSections({
	view,
	onClose,
}: {
	view: AdminUserView;
	onClose: () => void;
}) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const active = useActiveSection(scrollRef, true);
	const [banOpen, setBanOpen] = useState(false);
	const [deleteOpen, setDeleteOpen] = useState(false);
	const now = Date.now();
	const jump = (id: SheetSectionId) => {
		document.getElementById(`user-sheet-${id}`)?.scrollIntoView({
			block: "start",
			behavior: prefersReducedMotion() ? "auto" : "smooth",
		});
	};
	return (
		<div
			className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain lg:overflow-hidden"
			ref={scrollRef}
		>
			<UserSheetHeader
				onBan={() => {
					setBanOpen(true);
					jump("danger");
				}}
				onDelete={() => setDeleteOpen(true)}
				view={view}
			/>
			<div className="flex lg:min-h-0 lg:flex-1">
				<div className="flex min-w-0 flex-1 flex-col lg:min-h-0">
					<nav
						aria-label="Sections"
						className="sticky top-0 z-(--z-sticky) flex h-11 shrink-0 items-end gap-5 overflow-x-auto border-line-faint border-b bg-paper px-4 sm:px-6"
					>
						{SHEET_SECTIONS.map((section) => (
							<button
								aria-current={active === section.id ? "true" : undefined}
								className={cn(
									"flex h-11 shrink-0 items-center border-transparent border-b-2 type-label text-text-2 transition-colors duration-(--dur-state) hover:text-text-1 focus-visible:focus-ring-inset",
									active === section.id && "border-ink text-text-1",
								)}
								key={section.id}
								onClick={() => jump(section.id)}
								type="button"
							>
								{section.label}
							</button>
						))}
					</nav>
					<div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain">
						<div className="flex flex-col gap-10 px-4 pt-6 pb-10 sm:px-6">
							<AccessSection now={now} view={view} />
							<FlagsSection view={view} />
							<AccountSection view={view} />
							<ModerationSection view={view} />
							<ActivitySection userId={view.user.id} />
							<DangerSection
								banOpen={banOpen}
								onBanOpenChange={setBanOpen}
								onDelete={() => setDeleteOpen(true)}
								view={view}
							/>
							<div className="border-line-faint border-t pt-6 lg:hidden">
								<DetailsRail view={view} />
							</div>
						</div>
					</div>
				</div>
				<aside
					aria-label="Details"
					className="hidden w-74 shrink-0 overflow-y-auto border-line-faint border-s p-6 lg:block"
				>
					<DetailsRail view={view} />
				</aside>
			</div>
			<DeleteUserDialog
				onDeleted={onClose}
				onOpenChange={setDeleteOpen}
				open={deleteOpen}
				view={view}
			/>
		</div>
	);
}

function SheetBodyFor({
	userId,
	onClose,
}: {
	userId: string;
	onClose: () => void;
}) {
	const { data, isLoading, error, refetch } = useQuery(
		adminUserQueryOptions(userId),
	);
	if (isLoading) {
		return <UserSheetSkeleton />;
	}
	if (error) {
		return (
			<div className="flex flex-col items-start gap-3 p-6">
				<SheetTitle>Tripwire couldn't load this user</SheetTitle>
				<QuietLine>{error.message}</QuietLine>
				<Button onClick={() => void refetch()} size="sm" variant="secondary">
					Load user again
				</Button>
			</div>
		);
	}
	if (!data) {
		return (
			<div className="flex flex-col gap-3 p-6">
				<SheetTitle>This user no longer exists</SheetTitle>
				<QuietLine>They may have deleted their account.</QuietLine>
			</div>
		);
	}
	return <SheetSections key={data.user.id} onClose={onClose} view={data} />;
}

export function UserSheet({
	userId,
	position,
	onStep,
	onClose,
}: {
	userId: string | undefined;
	position: SheetPosition;
	onStep: (step: SheetStep) => void;
	onClose: () => void;
}) {
	const [shown, setShown] = useState(userId);
	if (userId && userId !== shown) {
		setShown(userId);
	}
	return (
		<Sheet
			onOpenChange={(open) => {
				if (!open) {
					onClose();
				}
			}}
			open={userId !== undefined}
		>
			<SheetContent
				className="data-[side=left]:w-full data-[side=right]:w-full data-[side=left]:max-w-250 data-[side=right]:max-w-250"
				showCloseButton={false}
			>
				<div className="flex h-13 shrink-0 items-center justify-between gap-2 border-line-faint border-b px-4 sm:px-6">
					<div className="flex items-center gap-2">
						<Button
							aria-label="Previous user"
							disabled={!position.prev}
							onClick={() => onStep(position.prev)}
							size="icon-sm"
							variant="secondary"
						>
							<Icon icon={ChevronUp} />
						</Button>
						<Button
							aria-label="Next user"
							disabled={!position.next}
							onClick={() => onStep(position.next)}
							size="icon-sm"
							variant="secondary"
						>
							<Icon icon={ChevronDown} />
						</Button>
						<span className="ps-1 type-caption text-text-2 tabular-nums">
							{position.label}
						</span>
					</div>
					<SheetClose
						aria-label="Close"
						render={<Button size="icon-sm" variant="ghost" />}
					>
						<Icon icon={Close} />
					</SheetClose>
				</div>
				{shown ? <SheetBodyFor onClose={onClose} userId={shown} /> : null}
			</SheetContent>
		</Sheet>
	);
}
