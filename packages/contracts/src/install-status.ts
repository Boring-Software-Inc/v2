import { z } from "zod";
import { forgeSchema } from "./forges.ts";

export const installAccessResultSchema = z.enum([
	"pending",
	"granted-admin",
	"denied",
	"not-admin",
	"not-for-tripwire",
	"token-expired",
	"failed",
]);
export type InstallAccessResult = z.infer<typeof installAccessResultSchema>;

export const INSTALL_ACCESS_CHECK_TTL_SECONDS = 600;

const installStatusBase = {
	installationId: z.string(),
	forge: forgeSchema,
};

export const installStatusSchema = z.discriminatedUnion("status", [
	z.object({
		...installStatusBase,
		status: z.literal("claimable"),
		account: z.string().nullable(),
		repoCount: z.number(),
		stateOrg: z
			.object({ id: z.string(), slug: z.string(), name: z.string() })
			.nullable(),
	}),
	z.object({
		...installStatusBase,
		status: z.literal("claimed-by-your-org"),
		orgSlug: z.string(),
	}),
	z.object({ ...installStatusBase, status: z.literal("processing") }),
	z.object({ ...installStatusBase, status: z.literal("recovering") }),
	z.object({ ...installStatusBase, status: z.literal("unreadable") }),
	z.object({
		...installStatusBase,
		status: z.literal("missing"),
		recoverable: z.boolean(),
	}),
	z.object({ ...installStatusBase, status: z.literal("not-for-tripwire") }),
	z.object({
		...installStatusBase,
		status: z.literal("not-yours"),
		recoverable: z.boolean(),
	}),
	z.object({ ...installStatusBase, status: z.literal("token-expired") }),
	z.object({
		...installStatusBase,
		status: z.literal("not-admin"),
		account: z.string().nullable(),
	}),
]);
export type InstallStatus = z.infer<typeof installStatusSchema>;
export type ClaimableInstallStatus = Extract<
	InstallStatus,
	{ status: "claimable" }
>;
