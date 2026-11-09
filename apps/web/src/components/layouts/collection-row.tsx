import type { ComponentProps, ReactNode } from "react";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemGroup,
	ItemMedia,
} from "#/design-system/ui/item";
import { SelectTrigger } from "#/design-system/ui/select";
import { Skeleton, SkeletonText } from "#/design-system/ui/skeleton";

interface CollectionRowProps {
	content: ReactNode;
	media?: ReactNode;
	actions?: ReactNode;
	overlay?: ReactNode;
}

interface RowPartProps {
	children: ReactNode;
}

type MemberRoleSelectTriggerProps = Omit<
	ComponentProps<typeof SelectTrigger>,
	"className" | "size"
>;

export function CollectionRow({
	content,
	media,
	actions,
	overlay,
}: CollectionRowProps) {
	return (
		<Item data-layout-role="collection-row">
			<div data-layout-role="collection-row-main">
				{media}
				{content}
			</div>
			{actions}
			{overlay}
		</Item>
	);
}

export function MemberRowActions({ children }: RowPartProps) {
	return (
		<ItemActions data-layout-role="member-row-actions">{children}</ItemActions>
	);
}

export function InviteRowActions({ children }: RowPartProps) {
	return (
		<ItemActions data-layout-role="invite-row-actions">{children}</ItemActions>
	);
}

export function MemberRoleSelectTrigger(props: MemberRoleSelectTriggerProps) {
	return (
		<SelectTrigger
			data-layout-role="member-role-trigger"
			size="sm"
			{...props}
		/>
	);
}

export function MemberActionMenuSlot({ children }: RowPartProps) {
	return <span data-layout-role="member-action-menu-slot">{children}</span>;
}

const ROW_SLOTS = ["a", "b", "c"] as const;

export function MemberRowsSkeleton() {
	return (
		<div className="shell">
			<ItemGroup aria-hidden>
				{ROW_SLOTS.map((slot) => (
					<CollectionRow
						content={
							<ItemContent>
								<SkeletonText className="w-32" type="label" />
								<SkeletonText className="w-44" type="body-sm" />
							</ItemContent>
						}
						key={slot}
						media={
							<ItemMedia>
								<Skeleton className="size-8 rounded-pill" />
							</ItemMedia>
						}
					/>
				))}
			</ItemGroup>
		</div>
	);
}

export function InviteRowsSkeleton() {
	return (
		<div className="shell">
			<ItemGroup aria-hidden>
				{ROW_SLOTS.slice(0, 2).map((slot) => (
					<CollectionRow
						content={
							<ItemContent>
								<SkeletonText className="w-28" type="label" />
							</ItemContent>
						}
						key={slot}
					/>
				))}
			</ItemGroup>
		</div>
	);
}
