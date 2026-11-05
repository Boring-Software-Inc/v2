import { z } from "zod";
import { accessStatusSchema } from "./access.ts";

const optionalSearchTextSchema = z
	.string({ error: "Expected search text" })
	.optional()
	.catch(undefined);

export const oauthWaitlistSearchSchema = z.object({
	opener: optionalSearchTextSchema,
	mode: optionalSearchTextSchema,
});
export type OauthWaitlistSearch = z.infer<typeof oauthWaitlistSearchSchema>;

export const oauthPopupSearchSchema = oauthWaitlistSearchSchema.extend({
	error: optionalSearchTextSchema,
});
export type OauthPopupSearch = z.infer<typeof oauthPopupSearchSchema>;

export const loginSearchSchema = z.object({
	redirect: optionalSearchTextSchema,
});
export type LoginSearch = z.infer<typeof loginSearchSchema>;

export const waitlistNotificationSchema = z.discriminatedUnion("status", [
	z.object({
		type: z.literal("tripwire:waitlist"),
		status: z.literal("error"),
	}),
	z.object({
		type: z.literal("tripwire:waitlist"),
		status: accessStatusSchema,
		name: z.string(),
	}),
]);
export type WaitlistNotification = z.infer<typeof waitlistNotificationSchema>;
