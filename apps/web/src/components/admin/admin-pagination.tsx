import { Button } from "@tripwire/ui/button";
import { PaginationInfo } from "@tripwire/ui/pagination";
import { Caption } from "@tripwire/ui/typography";
import { ADMIN_PAGE_SIZE } from "#/lib/admin.query";

export function AdminPagination({
	offset,
	total,
	noun,
	onOffsetChange,
}: {
	offset: number;
	total: number;
	noun: string;
	onOffsetChange: (offset: number) => void;
}) {
	return (
		<div data-layout-role="admin-pagination">
			{total === 0 ? (
				<Caption>0 {noun}</Caption>
			) : (
				<PaginationInfo
					from={offset + 1}
					noun={noun}
					to={Math.min(offset + ADMIN_PAGE_SIZE, total)}
					total={total}
				/>
			)}
			<div data-layout-role="admin-pagination-actions">
				<Button
					disabled={offset === 0}
					onAction={() => onOffsetChange(Math.max(0, offset - ADMIN_PAGE_SIZE))}
					size="small"
					variant="secondary"
				>
					Previous
				</Button>
				<Button
					disabled={offset + ADMIN_PAGE_SIZE >= total}
					onAction={() => onOffsetChange(offset + ADMIN_PAGE_SIZE)}
					size="small"
					variant="secondary"
				>
					Next
				</Button>
			</div>
		</div>
	);
}
