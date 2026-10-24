import {
	type StaffAuditAction,
	type StaffAuditDetail,
	staffAuditDetailSchema,
} from "@tripwire/contracts";
import { generateId } from "@tripwire/utils";
import { desc, eq } from "drizzle-orm";
import type { Db } from "../client.ts";
import { user } from "../schema/auth.ts";
import { staffAuditLog } from "../schema/staff.ts";
import type { DbLike } from "./access.ts";

export interface StaffAuditEntry {
	id: string;
	actorId: string;
	actorName: string | null;
	action: StaffAuditAction;
	detail: StaffAuditDetail | null;
	createdAt: Date;
}

export async function recordStaffAudit(
	db: DbLike,
	input: {
		actorId: string;
		targetUserId: string | null;
		action: StaffAuditAction;
		detail?: StaffAuditDetail;
	},
): Promise<void> {
	const detail = input.detail
		? staffAuditDetailSchema.parse(input.detail)
		: null;
	await db.insert(staffAuditLog).values({
		id: generateId(),
		actorId: input.actorId,
		targetUserId: input.targetUserId,
		action: input.action,
		detail,
	});
}

export async function listStaffAuditForUser(
	db: Db,
	userId: string,
	limit = 50,
): Promise<StaffAuditEntry[]> {
	const rows = await db
		.select({
			id: staffAuditLog.id,
			actorId: staffAuditLog.actorId,
			actorName: user.name,
			action: staffAuditLog.action,
			detail: staffAuditLog.detail,
			createdAt: staffAuditLog.createdAt,
		})
		.from(staffAuditLog)
		.leftJoin(user, eq(user.id, staffAuditLog.actorId))
		.where(eq(staffAuditLog.targetUserId, userId))
		.orderBy(desc(staffAuditLog.createdAt), desc(staffAuditLog.id))
		.limit(Math.min(Math.max(1, limit), 200));
	return rows.map((row) => {
		const detail = staffAuditDetailSchema.safeParse(row.detail);
		return { ...row, detail: detail.success ? detail.data : null };
	});
}
