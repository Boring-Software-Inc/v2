import { type LiveMessage, liveNotificationSchema } from "@tripwire/contracts";
import type { Db } from "../client.ts";
import { getWorkflowWork, repoFullNameOf } from "./agent-work.ts";
import { getSetupRunForLive } from "./setup.ts";

export interface LiveViewer {
	userId: string | null;
	canSeeRepo: (repoId: string) => boolean;
}

/**
 * Turns one `agent` channel notification into the message a viewer may see,
 * or null. Work goes to anyone who can see the repo; setup progress only to
 * the person whose run it is.
 */
export async function liveMessageFor(
	db: Db,
	payload: string,
	viewer: LiveViewer,
): Promise<LiveMessage | null> {
	let raw: unknown;
	try {
		raw = JSON.parse(payload);
	} catch {
		return null;
	}
	const parsed = liveNotificationSchema.safeParse(raw);
	if (!parsed.success) {
		return null;
	}
	const note = parsed.data;
	if (note.type === "setup") {
		const found = await getSetupRunForLive(db, note.runId);
		if (!found || (viewer.userId !== null && viewer.userId !== found.userId)) {
			return null;
		}
		return { type: "setup", orgId: found.orgId, run: found.run };
	}
	const repoFullName = await repoFullNameOf(db, note.repoId);
	if (!(repoFullName && viewer.canSeeRepo(note.repoId))) {
		return null;
	}
	const work = await getWorkflowWork(db, {
		repoId: note.repoId,
		definitionId: note.definitionId,
	});
	return { type: "work", repoFullName, work };
}
