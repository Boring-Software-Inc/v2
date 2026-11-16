import { useQuery } from "@tanstack/react-query";
import { Button } from "@tripwire/ui/button";
import { Sheet } from "@tripwire/ui/drawer";
import { ChevronDown, ChevronUp, Close, Icon } from "@tripwire/ui/icon";
import { Caption, Subheading } from "@tripwire/ui/typography";
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

function useUserSheetQuery(userId: string | undefined) {
	return useQuery({
		...adminUserQueryOptions(userId ?? ""),
		enabled: userId !== undefined,
	});
}

function SheetBody({
	onClose,
	query,
}: {
	onClose: () => void;
	query: ReturnType<typeof useUserSheetQuery>;
}) {
	const { data, isLoading, error, refetch } = query;
	if (isLoading) {
		return <UserSheetSkeleton />;
	}
	if (error) {
		return (
			<div data-layout-role="user-sheet-state">
				<Subheading>Tripwire couldn't load this user</Subheading>
				<QuietLine>{error.message}</QuietLine>
				<Button
					onAction={() => void refetch()}
					size="small"
					variant="secondary"
				>
					Load user again
				</Button>
			</div>
		);
	}
	if (!data) {
		return (
			<div data-layout-role="user-sheet-state">
				<Subheading>This user no longer exists</Subheading>
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
	const details = useUserSheetQuery(userId ?? shown);
	return (
		<Sheet
			bodyInset="content"
			onOpenChange={(open) => {
				if (!open) {
					onClose();
				}
			}}
			open={userId !== undefined}
			showFooter={false}
			showHeader={false}
			title={details.data?.user.name ?? "User details"}
			width="large"
		>
			<div data-layout-role="user-sheet">
				<div data-layout-role="user-sheet-toolbar">
					<div data-layout-role="user-sheet-stepper">
						<Button
							ariaLabel="Previous user"
							disabled={!position.prev}
							onAction={() => onStep(position.prev)}
							size="small"
							variant="secondary"
						>
							<Icon icon={ChevronUp} />
						</Button>
						<Button
							ariaLabel="Next user"
							disabled={!position.next}
							onAction={() => onStep(position.next)}
							size="small"
							variant="secondary"
						>
							<Icon icon={ChevronDown} />
						</Button>
						<Caption>{position.label}</Caption>
					</div>
					<Button
						ariaLabel="Close"
						onAction={onClose}
						size="small"
						variant="ghost"
					>
						<Icon icon={Close} />
					</Button>
				</div>
				{shown ? <SheetBody onClose={onClose} query={details} /> : null}
			</div>
		</Sheet>
	);
}
