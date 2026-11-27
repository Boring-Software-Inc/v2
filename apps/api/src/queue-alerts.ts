import { captureMessage } from "@sentry/bun";
import { type Db, type QueueHealth, queueServices } from "@tripwire/db";
import { getErrorMessage, guardedPost } from "@tripwire/utils";
import type { Logger } from "pino";

/**
 * Pages when GitHub event processing stops keeping up. It runs in the api, not
 * the worker: the api receives every webhook so it never sits idle, and a
 * stopped worker can't report that it stopped. (Staging's worker sat 17 hours
 * behind with nothing noticing.) The worker also checks in with Sentry every
 * minute, so the api going down is caught from the other side.
 */
export interface QueueAlertRule {
	key: string;
	title: string;
	firing(health: QueueHealth): boolean;
	detail(health: QueueHealth): string;
}

export const QUEUE_ALERT_RULES: readonly QueueAlertRule[] = [
	{
		key: "github-evaluate-backlog",
		title: "GitHub PR checks are backing up",
		firing: (health) => health.evaluateAgeSeconds > 5 * 60,
		detail: (health) =>
			`the oldest has waited ${duration(health.evaluateAgeSeconds)} (limit 5m), ${health.evaluateReady} waiting`,
	},
	{
		key: "process-event-backlog",
		title: "GitHub event processing is backing up",
		firing: (health) => health.processAgeSeconds > 15 * 60,
		detail: (health) =>
			`the oldest has waited ${duration(health.processAgeSeconds)} (limit 15m), ${health.processReady} waiting`,
	},
	{
		key: "github-worker-down",
		title: "The GitHub worker stopped checking in",
		firing: (health) =>
			health.workerHeartbeatAgeSeconds !== null &&
			health.workerHeartbeatAgeSeconds > 3 * 60,
		detail: (health) =>
			`last check-in ${duration(health.workerHeartbeatAgeSeconds ?? 0)} ago (limit 3m)`,
	},
	{
		key: "github-evaluate-dead-letters",
		title: "GitHub PR checks failed every retry",
		firing: (health) => health.deadLetteredLastDay > 0,
		detail: (health) =>
			`${health.deadLetteredLastDay} in the last day, kept in the github-evaluate-dead queue`,
	},
	{
		key: "github-deliveries-lost",
		title: "GitHub webhooks were never stored",
		firing: (health) => health.lostDeliveriesLastDay > 0,
		detail: (health) =>
			`${health.lostDeliveriesLastDay} in the last day that should have run or been kept, listed in github_delivery_audit`,
	},
];

/** A rule fires after this many samples in a row, so one slow minute doesn't page. */
const SAMPLES_TO_FIRE = 2;

export interface QueueAlertsSnapshot {
	ok: boolean;
	firing: string[];
	health: QueueHealth | null;
	sampledAt: string | null;
}

export interface QueueAlertsOptions {
	db: Db;
	logger: Logger;
	/** Discord webhook; without one, alerts reach only the logs and Sentry. */
	webhookUrl: string | null;
	environment: string;
	post?: (url: string, body: { content: string }) => Promise<{ ok: boolean }>;
	/**
	 * Opens an issue per firing alert. Sentry keeps pino logs as logs, which
	 * notify no one, so without this an alert with no Discord webhook was
	 * silent.
	 */
	capture?: (alert: QueueAlertRule, message: string) => void;
	readHealth?: typeof queueServices.readQueueHealth;
	recordState?: typeof queueServices.recordAlertState;
	intervalMs?: number;
}

export function startQueueAlerts(options: QueueAlertsOptions) {
	const post = options.post ?? guardedPost;
	const capture = options.capture ?? captureAlert;
	const readHealth = options.readHealth ?? queueServices.readQueueHealth;
	const recordState = options.recordState ?? queueServices.recordAlertState;
	const streaks = new Map<string, number>();
	let snapshot: QueueAlertsSnapshot = {
		ok: true,
		firing: [],
		health: null,
		sampledAt: null,
	};

	const notify = async (content: string) => {
		if (!options.webhookUrl) return;
		const result = await post(options.webhookUrl, { content });
		if (!result.ok) options.logger.warn("queue alert post failed");
	};

	const sample = async () => {
		try {
			const health = await readHealth(options.db);
			const firing: string[] = [];
			for (const rule of QUEUE_ALERT_RULES) {
				const streak = rule.firing(health)
					? (streaks.get(rule.key) ?? 0) + 1
					: 0;
				streaks.set(rule.key, streak);
				const isFiring = streak >= SAMPLES_TO_FIRE;
				if (isFiring) firing.push(rule.key);
				const change = await recordState(options.db, rule.key, isFiring);
				if (!change) continue;
				const where = `[${options.environment}] ${rule.title}`;
				if (change.firing) {
					options.logger.error(
						{ event: "queue.alert", alert: rule.key, health },
						`${rule.title}: ${rule.detail(health)}`,
					);
					capture(rule, `${where}: ${rule.detail(health)}`);
					await notify(`**FIRING** ${where}: ${rule.detail(health)}.`);
				} else {
					options.logger.info(
						{ event: "queue.recovered", alert: rule.key },
						`${rule.title}: recovered`,
					);
					await notify(
						`**RESOLVED** ${where}${change.sinceSeconds === null ? "" : `, after ${duration(change.sinceSeconds)}`}.`,
					);
				}
			}
			snapshot = {
				ok: firing.length === 0,
				firing,
				health,
				sampledAt: new Date().toISOString(),
			};
		} catch (error) {
			options.logger.warn(
				{ event: "queue.alert.sample.failed", error: getErrorMessage(error) },
				"queue alert sample failed",
			);
		}
	};

	const timer = setInterval(sample, options.intervalMs ?? 60_000);
	void sample();
	return {
		snapshot: () => snapshot,
		sample,
		stop: () => clearInterval(timer),
	};
}

/** One Sentry issue per alert, so each firing adds an event to it. */
function captureAlert(alert: QueueAlertRule, message: string) {
	captureMessage(message, {
		level: "error",
		fingerprint: ["queue-alert", alert.key],
		tags: { service: "api", alert: alert.key },
	});
}

export function duration(seconds: number): string {
	const total = Math.round(seconds);
	if (total < 60) return `${total}s`;
	const minutes = Math.floor(total / 60);
	if (minutes < 60) return `${minutes}m ${total % 60}s`;
	const hours = Math.floor(minutes / 60);
	return `${hours}h ${minutes % 60}m`;
}
