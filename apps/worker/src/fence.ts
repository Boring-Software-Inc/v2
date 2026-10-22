import { type Db, workerDeploymentServices } from "@tripwire/db";
import { generateId, getErrorMessage } from "@tripwire/utils";
import type { Logger } from "pino";

export const FENCE_TICK_MS = 10_000;
export const FENCE_STALE_AFTER_MS = 45_000;
export const FENCE_PRUNE_AFTER_MS = 86_400_000;

export type FenceAction = "consume" | "pause" | "hold";

export function fenceAction(
	consuming: boolean,
	leaderId: string | null,
	me: string,
): FenceAction {
	const leads = leaderId === null || leaderId === me;
	if (leads && !consuming) {
		return "consume";
	}
	if (!leads && consuming) {
		return "pause";
	}
	return "hold";
}

export function resolveDeploymentId(
	env: Record<string, string | undefined> = process.env,
): string {
	return env.UNKEY_DEPLOYMENT_ID || `local-${generateId()}`;
}

export interface FenceOptions {
	db: Db;
	deploymentId: string;
	logger: Logger;
	consume(): Promise<void>;
	pause(): Promise<void>;
}

export interface Fence {
	leader(): boolean;
	stop(): void;
}

export async function startFence(options: FenceOptions): Promise<Fence> {
	const { db, deploymentId, logger } = options;
	let consuming = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let stopped = false;

	const tick = async (): Promise<void> => {
		const leaderId = await workerDeploymentServices.leader(
			db,
			FENCE_STALE_AFTER_MS,
		);
		const action = fenceAction(consuming, leaderId, deploymentId);
		if (action === "consume") {
			await options.consume();
			consuming = true;
			logger.info(
				{ deploymentId, leaderId },
				"fence: newest live deployment, consuming queues",
			);
		} else if (action === "pause") {
			await options.pause();
			consuming = false;
			logger.warn(
				{ deploymentId, leaderId },
				"fence: newer deployment is live, queues paused",
			);
		}
	};

	await workerDeploymentServices.register(db, deploymentId);
	try {
		await workerDeploymentServices.prune(db, FENCE_PRUNE_AFTER_MS);
	} catch (error) {
		logger.warn({ error: getErrorMessage(error) }, "fence: prune failed");
	}
	await tick();
	if (!consuming) {
		logger.warn({ deploymentId }, "fence: started paused");
	}

	const loop = async (): Promise<void> => {
		try {
			await workerDeploymentServices.heartbeat(db, deploymentId);
			await tick();
		} catch (error) {
			logger.error(
				{ deploymentId, error: getErrorMessage(error) },
				"fence: heartbeat failed, keeping current state",
			);
		}
		if (!stopped) {
			timer = setTimeout(loop, FENCE_TICK_MS);
		}
	};
	timer = setTimeout(loop, FENCE_TICK_MS);

	return {
		leader: () => consuming,
		stop: () => {
			stopped = true;
			clearTimeout(timer);
		},
	};
}
