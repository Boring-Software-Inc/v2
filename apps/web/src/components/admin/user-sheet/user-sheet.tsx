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
import { ChevronDown, ChevronUp, Close, Icon } from "#/design-system/icon";
import { Button } from "#/design-system/ui/button";
import {
	Sheet,
	SheetClose,
	SheetContent,
	SheetTitle,
} from "#/design-system/ui/sheet";
import { Caption } from "#/design-system/ui/typography";
import {
	SHEET_SECTIONS,
	type SheetPosition,
	type SheetSectionId,
	type SheetStep,
} from "#/lib/admin-user-sheet";
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
		<div data-layout-role="user-sheet-scroll" ref={scrollRef}>
			<UserSheetHeader
				onBan={() => {
					setBanOpen(true);
					jump("danger");
				}}
				onDelete={() => setDeleteOpen(true)}
				view={view}
			/>
			<div data-layout-role="user-sheet-workspace">
				<div data-layout-role="user-sheet-main">
					<nav aria-label="Sections" data-layout-role="user-sheet-nav">
						{SHEET_SECTIONS.map((section) => (
							<button
								aria-current={active === section.id ? "true" : undefined}
								data-active={active === section.id ? "" : undefined}
								key={section.id}
								onClick={() => jump(section.id)}
								type="button"
							>
								{section.label}
							</button>
						))}
					</nav>
					<div data-layout-role="user-sheet-sections-scroll">
						<div data-layout-role="user-sheet-sections">
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
							<div data-layout-role="user-sheet-details-mobile">
								<DetailsRail view={view} />
							</div>
						</div>
					</div>
				</div>
				<aside aria-label="Details" data-layout-role="user-sheet-details-rail">
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
			<div data-layout-role="user-sheet-state">
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
			<div data-layout-role="user-sheet-state">
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
			<SheetContent data-layout-role="user-sheet" showCloseButton={false}>
				<div data-layout-role="user-sheet-toolbar">
					<div data-layout-role="user-sheet-stepper">
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
						<Caption>{position.label}</Caption>
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
