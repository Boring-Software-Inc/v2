import {
	type AiCreditsState,
	aiCreditsFromBalance,
	type OpenRouterCredits,
	type OpenRouterKey,
	openRouterCreditsSchema,
	openRouterKeySchema,
} from "@tripwire/contracts";
import { getErrorMessage } from "@tripwire/utils";
import type { Logger } from "pino";
import type { z } from "zod";
import type { ReportAiCredits } from "../report-unrunnable.ts";

export const CHECK_AI_CREDITS_QUEUE = "check-ai-credits";
export const CHECK_AI_CREDITS_CRON = "*/5 * * * *";

const OPENROUTER_API = "https://openrouter.ai/api/v1";

export interface CheckAiCreditsDeps {
	logger: Logger;
	fetch: (
		input: Parameters<typeof fetch>[0],
		init?: Parameters<typeof fetch>[1],
	) => Promise<Response>;
	record: (state: AiCreditsState) => Promise<{ changed: boolean }>;
	report: ReportAiCredits;
}

async function readBalance<T extends z.ZodType>(
	deps: CheckAiCreditsDeps,
	path: string,
	key: string | null,
	schema: T,
): Promise<z.infer<T> | null> {
	if (!key) {
		return null;
	}
	try {
		const res = await deps.fetch(`${OPENROUTER_API}${path}`, {
			headers: { authorization: `Bearer ${key}` },
		});
		if (!res.ok) {
			deps.logger.warn({ path, status: res.status }, "AI credit read failed");
			return null;
		}
		const parsed = schema.safeParse(await res.json());
		return parsed.success ? parsed.data : null;
	} catch (error) {
		deps.logger.warn(
			{ path, error: getErrorMessage(error) },
			"AI credit read failed",
		);
		return null;
	}
}

export async function checkAiCredits(
	deps: CheckAiCreditsDeps,
	keys: { inferenceKey: string | null; managementKey: string | null },
): Promise<AiCreditsState | "unknown"> {
	const [credits, key]: [OpenRouterCredits | null, OpenRouterKey | null] =
		await Promise.all([
			readBalance(
				deps,
				"/credits",
				keys.managementKey,
				openRouterCreditsSchema,
			),
			readBalance(deps, "/key", keys.inferenceKey, openRouterKeySchema),
		]);
	const state = aiCreditsFromBalance({ credits, key });
	if (state === "unknown") {
		return state;
	}
	const { changed } = await deps.record(state);
	if (changed) {
		if (state === "out") {
			deps.logger.error("AI provider is out of credits");
			deps.report({ source: "credit check" });
		} else {
			deps.logger.info("AI provider has credits again");
		}
	}
	return state;
}
