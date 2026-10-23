async function postAuth<T>(path: string, body: unknown): Promise<T> {
	const res = await fetch(`/api/auth${path}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		credentials: "same-origin",
		body: JSON.stringify(body),
	});
	const data = (await res.json().catch(() => null)) as
		| (T & { message?: string; error_description?: string })
		| null;
	if (!(res.ok && data)) {
		throw new Error(
			data?.error_description ??
				data?.message ??
				"Tripwire could not save your answer. Try again.",
		);
	}
	return data;
}

export async function answerConsent(
	oauthQuery: string,
	accept: boolean,
): Promise<string> {
	const { url } = await postAuth<{ url: string }>("/oauth2/consent", {
		accept,
		oauth_query: oauthQuery,
	});
	return url;
}

export async function answerDevice(
	userCode: string,
	accept: boolean,
): Promise<void> {
	await postAuth(accept ? "/device/approve" : "/device/deny", { userCode });
}
