import {
	type GitCafeCheckReportInput,
	type GitCafeCheckReportResponse,
	type GitCafeCheckRerequestedEvent,
	type GitCafeInstallation,
	type GitCafeReportedCheck,
	gitCafeCheckPullSchema,
	gitCafeCheckReportInputSchema,
	gitCafeCheckReportResponseSchema,
	gitCafeCheckRerequestedEventSchema,
	gitCafeReportedCheckSchema,
} from "@tripwire/contracts";
import type {
	GitCafeInstallationClient,
	GitCafeInstallationResult,
} from "./installation-client.ts";

/** A signed re-run request must still identify this installation's current check before local work is queued. */
export async function verifyGitCafeCheckRerequest(
	client: GitCafeInstallationClient,
	expectedInstallation: GitCafeInstallation,
	input: GitCafeCheckRerequestedEvent,
	number: number,
	deadlineAt?: number,
): Promise<GitCafeInstallationResult<GitCafeReportedCheck>> {
	const parsed = gitCafeCheckRerequestedEventSchema.safeParse(input);
	if (
		!parsed.success ||
		!gitCafeCheckPullSchema.shape.number.safeParse(number).success
	)
		return { ok: false, reason: "invalid-response" };
	const event = parsed.data;
	if (
		event.installation.id !== expectedInstallation.id ||
		event.repository.owner !== expectedInstallation.org ||
		event.bot.id !== expectedInstallation.bot.actorId ||
		!event.actor ||
		event.actor.id === event.bot.id ||
		event.checkRun.key !== "tripwire" ||
		event.checkRun.name !== "tripwire" ||
		!event.checkRun.externalId ||
		!/^[A-Za-z0-9_-]{1,255}$/.test(event.checkRun.id)
	)
		return { ok: false, reason: "identity-mismatch" };
	const result = await client.request(
		expectedInstallation.id,
		{
			method: "GET",
			resourcePath: `repos/${event.repository.owner}/${event.repository.name}/check-runs/${event.checkRun.id}`,
		},
		expectedInstallation,
		deadlineAt,
	);
	if (!result.ok) return result;
	const check = gitCafeReportedCheckSchema.safeParse(result.value);
	if (!check.success) return { ok: false, reason: "invalid-response" };
	if (
		check.data.id !== event.checkRun.id ||
		check.data.key !== event.checkRun.key ||
		check.data.headOid !== event.checkRun.headOid ||
		check.data.name !== event.checkRun.name ||
		check.data.externalId !== event.checkRun.externalId ||
		check.data.reporterId !== expectedInstallation.bot.actorId ||
		check.data.installationId !== expectedInstallation.id
	)
		return { ok: false, reason: "identity-mismatch" };
	if (
		check.data.status !== "queued" ||
		check.data.conclusion !== null ||
		!check.data.rerequestable ||
		check.data.rerequestedAt === null ||
		Date.parse(check.data.rerequestedAt) <= Date.parse(check.data.reportedAt) ||
		Date.parse(check.data.rerequestedAt) > Date.parse(event.createdAt)
	)
		return { ok: false, reason: "stale" };
	const pullResponse = await client.request(
		expectedInstallation.id,
		{
			method: "GET",
			resourcePath: `repos/${event.repository.owner}/${event.repository.name}/pulls/${number}`,
		},
		expectedInstallation,
		deadlineAt,
	);
	if (!pullResponse.ok) return pullResponse;
	const pull = gitCafeCheckPullSchema.safeParse(pullResponse.value);
	if (!pull.success) return { ok: false, reason: "invalid-response" };
	if (pull.data.repoId !== event.repository.id || pull.data.number !== number)
		return { ok: false, reason: "identity-mismatch" };
	if (
		pull.data.headOid !== event.checkRun.headOid ||
		pull.data.state !== "open"
	)
		return { ok: false, reason: "stale" };
	return { ok: true, value: check.data };
}

/** Retries must retain the persisted command's key and reportedAt so an older run cannot overwrite newer evidence. */
export async function reportGitCafeCheck(
	client: GitCafeInstallationClient,
	installationId: string,
	expectedInstallation: GitCafeInstallation,
	input: GitCafeCheckReportInput,
	deadlineAt?: number,
): Promise<GitCafeInstallationResult<GitCafeCheckReportResponse>> {
	const parsed = gitCafeCheckReportInputSchema.safeParse(input);
	if (!parsed.success) return { ok: false, reason: "invalid-response" };
	const command = parsed.data;
	const root = `repos/${command.repoFullName}`;
	const response = await client.request(
		installationId,
		{
			method: "PUT",
			resourcePath: `${root}/commits/${command.headOid}/check-runs/${encodeURIComponent(command.key)}`,
			body: JSON.stringify(command.check),
		},
		expectedInstallation,
		deadlineAt,
	);
	if (!response.ok) return response;
	const report = gitCafeCheckReportResponseSchema.safeParse(response.value);
	if (!report.success) return { ok: false, reason: "invalid-response" };
	if (report.data.outcome === "ignored_stale")
		return { ok: false, reason: "stale" };
	const check = report.data.checkRun;
	if (
		check.installationId !== installationId ||
		check.reporterId !== expectedInstallation.bot.actorId ||
		check.headOid !== command.headOid ||
		check.key !== command.key ||
		check.name !== command.check.name ||
		check.status !== command.check.status ||
		check.conclusion !== (command.check.conclusion ?? null) ||
		check.reportedAt !== command.check.reportedAt ||
		check.rerequestable !== command.check.rerequestable ||
		check.detailsUrl !== (command.check.detailsUrl ?? null) ||
		check.externalId !== (command.check.externalId ?? null) ||
		check.output.title !== command.check.output.title ||
		check.output.summary !== command.check.output.summary
	)
		return { ok: false, reason: "identity-mismatch" };
	if (!/^[A-Za-z0-9_-]+$/.test(check.id))
		return { ok: false, reason: "invalid-response" };
	const readback = await client.request(
		installationId,
		{ method: "GET", resourcePath: `${root}/check-runs/${check.id}` },
		expectedInstallation,
		deadlineAt,
	);
	if (!readback.ok) return readback;
	const persisted = gitCafeReportedCheckSchema.safeParse(readback.value);
	if (!persisted.success) return { ok: false, reason: "invalid-response" };
	return JSON.stringify(persisted.data) === JSON.stringify(check)
		? { ok: true, value: report.data }
		: { ok: false, reason: "stale" };
}
