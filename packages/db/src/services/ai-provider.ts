import type { AiCreditsState } from "@tripwire/contracts";
import { eq } from "drizzle-orm";
import type { Db } from "../client.ts";
import { aiProviderStatus } from "../schema/workers.ts";

const PROVIDER = "openrouter";

export async function getAiCredits(db: Db): Promise<AiCreditsState> {
	const [row] = await db
		.select({ credits: aiProviderStatus.credits })
		.from(aiProviderStatus)
		.where(eq(aiProviderStatus.provider, PROVIDER))
		.limit(1);
	return row?.credits ?? "ready";
}

export async function recordAiCredits(
	db: Db,
	credits: AiCreditsState,
	at: Date = new Date(),
): Promise<{ changed: boolean }> {
	return db.transaction(async (tx) => {
		const inserted = await tx
			.insert(aiProviderStatus)
			.values({ provider: PROVIDER, credits, checkedAt: at, changedAt: at })
			.onConflictDoNothing({ target: aiProviderStatus.provider })
			.returning({ provider: aiProviderStatus.provider });
		if (inserted.length > 0) {
			return { changed: credits !== "ready" };
		}
		const [row] = await tx
			.select({
				credits: aiProviderStatus.credits,
				checkedAt: aiProviderStatus.checkedAt,
			})
			.from(aiProviderStatus)
			.where(eq(aiProviderStatus.provider, PROVIDER))
			.for("update");
		if (!row || row.checkedAt > at) {
			return { changed: false };
		}
		const changed = row.credits !== credits;
		await tx
			.update(aiProviderStatus)
			.set(
				changed ? { credits, checkedAt: at, changedAt: at } : { checkedAt: at },
			)
			.where(eq(aiProviderStatus.provider, PROVIDER));
		return { changed };
	});
}
