import { createPrivateKey, sign } from "node:crypto";
import { generateId } from "@tripwire/utils";

export interface GitCafeAppCredentials {
	appId: string;
	keyId: string;
	privateKey: string;
}

export type GitCafeInstallationOperation = "lookup" | "mint";

export interface GitCafeInstallationRequest {
	url: string;
	init: RequestInit;
}

export function createGitCafeInstallationRequest(
	credentials: GitCafeAppCredentials,
	installationId: string,
	operation: GitCafeInstallationOperation,
	now = Date.now(),
): GitCafeInstallationRequest {
	if (
		(operation !== "lookup" && operation !== "mint") ||
		!/^[A-Za-z0-9_-]+$/.test(installationId) ||
		!credentials.appId ||
		!/^[A-Za-z0-9._-]{1,64}$/.test(credentials.keyId) ||
		!Number.isSafeInteger(now) ||
		now < 0
	) {
		throw new Error("Invalid GitCafe assertion parameters");
	}
	const key = createPrivateKey(credentials.privateKey);
	if (
		key.asymmetricKeyType !== "ec" ||
		key.asymmetricKeyDetails?.namedCurve !== "prime256v1"
	) {
		throw new Error("GitCafe requires a P-256 private key");
	}
	const url = `https://git.cafe/api/apps/installations/${installationId}${operation === "mint" ? "/access_tokens" : ""}`;
	const iat = Math.floor(now / 1000);
	const header = Buffer.from(
		JSON.stringify({ alg: "ES256", typ: "JWT", kid: credentials.keyId }),
	).toString("base64url");
	const payload = Buffer.from(
		JSON.stringify({
			iss: credentials.appId,
			sub: credentials.appId,
			aud: url,
			jti: generateId(),
			iat,
			exp: iat + 300,
		}),
	).toString("base64url");
	const input = `${header}.${payload}`;
	const assertion = `${input}.${sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
	if (operation === "lookup") {
		return {
			url,
			init: {
				method: "GET",
				headers: {
					authorization: `Bearer ${assertion}`,
					accept: "application/json",
				},
			},
		};
	}
	return {
		url,
		init: {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json",
			},
			body: JSON.stringify({
				client_assertion_type:
					"urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
				client_assertion: assertion,
			}),
		},
	};
}
