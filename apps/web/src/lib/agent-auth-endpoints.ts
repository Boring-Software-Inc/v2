import { z } from "zod";

interface AuthRequestBody {
	[key: string]: string | boolean;
}

const authErrorSchema = z
	.object({
		message: z.string().optional(),
		error_description: z.string().optional(),
	})
	.catch({});

async function postAuth<T>(
	path: string,
	body: AuthRequestBody,
	responseSchema: z.ZodType<T>,
): Promise<T> {
	const res = await fetch(`/api/auth${path}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		credentials: "same-origin",
		body: JSON.stringify(body),
	});
	const raw = await res.json().catch(() => null);
	const parsed = responseSchema.safeParse(raw);
	if (!(res.ok && parsed.success)) {
		const error = authErrorSchema.parse(raw);
		throw new Error(
			error.error_description ??
				error.message ??
				"Tripwire could not save your answer. Try again.",
		);
	}
	return parsed.data;
}

const consentResponseSchema = z.object({ url: z.string() });
const deviceResponseSchema = z.object({}).transform(() => undefined);

export async function answerConsent(
	oauthQuery: string,
	accept: boolean,
): Promise<string> {
	const { url } = await postAuth(
		"/oauth2/consent",
		{
			accept,
			oauth_query: oauthQuery,
		},
		consentResponseSchema,
	);
	return url;
}

export async function answerDevice(
	userCode: string,
	accept: boolean,
): Promise<void> {
	await postAuth(
		accept ? "/device/approve" : "/device/deny",
		{ userCode },
		deviceResponseSchema,
	);
}
