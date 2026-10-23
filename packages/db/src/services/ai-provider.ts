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
	const before = await getAiCredits(db);
	await db
		.insert(aiProviderStatus)
		.values({ provider: PROVIDER, credits, checkedAt: at, changedAt: at })
		.onConflictDoUpdate({
			target: aiProviderStatus.provider,
			set:
				before === credits
					? { checkedAt: at }
					: { credits, checkedAt: at, changedAt: at },
		});
	return { changed: before !== credits };
}
