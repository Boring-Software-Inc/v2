import { z } from "zod";
import { forgeSchema } from "./forges.ts";

export const organizationConnectionsInputSchema = z.strictObject({
	org: z.string().min(1),
});
export type OrganizationConnectionsInput = z.infer<
	typeof organizationConnectionsInputSchema
>;

export const organizationForgeConnectionSchema = z.object({
	forge: forgeSchema,
	installations: z.array(
		z.object({
			installationId: z.string().min(1),
			owner: z.string().nullable(),
			accountType: z.string().nullable(),
		}),
	),
	repositories: z.array(
		z.object({
			id: z.string().min(1),
			fullName: z.string().min(1),
			installationId: z.string().nullable(),
		}),
	),
});
export type OrganizationForgeConnection = z.infer<
	typeof organizationForgeConnectionSchema
>;

export const organizationForgeConnectionsSchema = z.array(
	organizationForgeConnectionSchema,
);
export type OrganizationForgeConnections = z.infer<
	typeof organizationForgeConnectionsSchema
>;
