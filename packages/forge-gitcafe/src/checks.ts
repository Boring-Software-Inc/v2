import {
	type GitCafeCheckReportInput,
	type GitCafeCheckReportResponse,
	type GitCafeInstallation,
	gitCafeCheckReportInputSchema,
	gitCafeCheckReportResponseSchema,
	gitCafeReportedCheckSchema,
} from "@tripwire/contracts";
import type {
	GitCafeInstallationClient,
	GitCafeInstallationResult,
} from "./installation-client.ts";

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
