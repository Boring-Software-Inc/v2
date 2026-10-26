import { createHash } from "node:crypto";
import {
	chmodSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
	authUrl,
	environment,
	mcpUrl,
	PRODUCTION_AUTH_URL,
	PRODUCTION_MCP_URL,
} from "#/config";
import type { System } from "#/system";

const credentialSchema = z.object({
	accessToken: z.string().min(1),
	refreshToken: z.string().min(1).optional(),
	expiresAt: z.number().optional(),
	mcpUrl: z.string(),
	authUrl: z.string(),
});

export type Credential = z.infer<typeof credentialSchema>;

export interface CredentialStore {
	readonly kind: "keychain" | "secret-service" | "file";
	readonly location: string;
	read(): Promise<Credential | null>;
	write(credential: Credential): Promise<void>;
	clear(): Promise<void>;
}

const SERVICE = "tripwire-cli";
function account(system: System): string {
	const auth = authUrl(system.env);
	const mcp = mcpUrl(system.env);
	if (
		environment(system.env) === "production" &&
		auth === PRODUCTION_AUTH_URL &&
		mcp === PRODUCTION_MCP_URL
	) {
		return "default";
	}
	const target = createHash("sha256")
		.update(JSON.stringify([auth, mcp]))
		.digest("hex");
	return `${environment(system.env)}-${target}`;
}

function decode(text: string | null): Credential | null {
	if (!text) {
		return null;
	}
	try {
		const parsed = credentialSchema.safeParse(JSON.parse(text));
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}

function credentialFilePath(system: System): string {
	return join(
		system.env.XDG_CONFIG_HOME || join(system.home, ".config"),
		"tripwire",
		account(system) === "default"
			? "credentials.json"
			: `credentials-${account(system)}.json`,
	);
}

function fileStore(system: System): CredentialStore {
	const path = credentialFilePath(system);
	return {
		kind: "file",
		location: path,
		read: async () => {
			try {
				return decode(readFileSync(path, "utf8"));
			} catch {
				return null;
			}
		},
		write: async (credential) => {
			const dir = join(path, "..");
			mkdirSync(dir, { recursive: true, mode: 0o700 });
			const temp = `${path}.${process.pid}.tmp`;
			writeFileSync(temp, JSON.stringify(credential), { mode: 0o600 });
			chmodSync(temp, 0o600);
			renameSync(temp, path);
		},
		clear: async () => {
			rmSync(path, { force: true });
		},
	};
}

function hex(text: string): string {
	return Buffer.from(text, "utf8").toString("hex");
}

function keychainStore(system: System, security: string): CredentialStore {
	return {
		kind: "keychain",
		location: "macOS keychain",
		read: async () => {
			const result = await system.run(security, [
				"find-generic-password",
				"-a",
				account(system),
				"-s",
				SERVICE,
				"-w",
			]);
			return result.ok ? decode(result.stdout) : null;
		},
		write: async (credential) => {
			const command = `add-generic-password -U -a ${account(system)} -s ${SERVICE} -l Tripwire -X ${hex(JSON.stringify(credential))}\n`;
			const result = await system.run(security, ["-i"], command);
			if (!result.ok) {
				throw new Error("Could not save the token to the macOS keychain");
			}
		},
		clear: async () => {
			await system.run(security, [
				"delete-generic-password",
				"-a",
				account(system),
				"-s",
				SERVICE,
			]);
		},
	};
}

function secretServiceStore(system: System, tool: string): CredentialStore {
	const attributes = ["service", SERVICE, "account", account(system)];
	return {
		kind: "secret-service",
		location: "Secret Service keyring",
		read: async () => {
			const result = await system.run(tool, ["lookup", ...attributes]);
			return result.ok ? decode(result.stdout) : null;
		},
		write: async (credential) => {
			const result = await system.run(
				tool,
				["store", "--label=Tripwire", ...attributes],
				JSON.stringify(credential),
			);
			if (!result.ok) {
				throw new Error("Could not save the token to the keyring");
			}
		},
		clear: async () => {
			await system.run(tool, ["clear", ...attributes]);
		},
	};
}

function withFileFallback(
	primary: CredentialStore,
	system: System,
): CredentialStore {
	const file = fileStore(system);
	return {
		kind: primary.kind,
		location: primary.location,
		read: async () => (await primary.read()) ?? (await file.read()),
		write: (credential) => primary.write(credential),
		clear: async () => {
			await primary.clear();
			await file.clear();
		},
	};
}

function targetStore(system: System): CredentialStore {
	if (system.env.TRIPWIRE_CREDENTIAL_STORE === "file") {
		return fileStore(system);
	}
	if (system.platform === "darwin") {
		const security = system.which("security");
		if (security) {
			return withFileFallback(keychainStore(system, security), system);
		}
	}
	if (system.platform === "linux") {
		const tool = system.which("secret-tool");
		if (tool) {
			return withFileFallback(secretServiceStore(system, tool), system);
		}
	}
	return fileStore(system);
}

export function credentialStore(system: System): CredentialStore {
	const store = targetStore(system);
	return {
		...store,
		read: async () => {
			const credential = await store.read();
			return credential &&
				credential.authUrl.replace(/\/+$/, "") === authUrl(system.env) &&
				credential.mcpUrl.replace(/\/+$/, "") === mcpUrl(system.env)
				? credential
				: null;
		},
	};
}
