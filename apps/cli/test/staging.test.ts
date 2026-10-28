import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { credentialStore } from "../src/auth/credentials";
import { realSystem } from "../src/system";
import { startFakeServer, TEST_TOKEN } from "./fake-server";
import { makeSandbox, runCli, type Sandbox } from "./sandbox";

let sandbox: Sandbox;
beforeEach(() => {
	sandbox = makeSandbox();
});
afterEach(() => sandbox.cleanup());

const PRODUCTION = {
	accessToken: "production-access-never-send",
	refreshToken: "production-refresh-never-send",
	mcpUrl: "https://mcp.tripwire.sh/mcp",
	authUrl: "https://app.tripwire.sh/api/auth",
};

test("staging login, refresh, manage and logout never use production credentials", async () => {
	const upstream = startFakeServer();
	const requests: string[] = [];
	const proxy = Bun.serve({
		port: 0,
		async fetch(request) {
			const url = new URL(request.url);
			requests.push(
				`${url.pathname} ${request.headers.get("authorization")} ${await request.clone().text()}`,
			);
			if (url.pathname.endsWith("/oauth2/revoke")) return Response.json({});
			return fetch(
				new Request(`${new URL(upstream.url).origin}${url.pathname}`, request),
			);
		},
	});
	try {
		const production = credentialStore(realSystem(sandbox.env));
		await production.write(PRODUCTION);
		const before = readFileSync(production.location, "utf8");
		const env = {
			...sandbox.env,
			TRIPWIRE_ENV: "staging",
			TRIPWIRE_TOKEN: PRODUCTION.accessToken,
			TRIPWIRE_MCP_URL: `http://127.0.0.1:${proxy.port}/mcp`,
			TRIPWIRE_AUTH_URL: `http://127.0.0.1:${proxy.port}/api/auth`,
		};
		const staging = credentialStore(realSystem(env));
		for (const expiresAt of [1, Date.now() + 3600_000]) {
			await staging.write({ ...PRODUCTION, expiresAt });
			const result = await runCli(["whoami", "--json"], env);
			expect(result.code).toBe(1);
			expect(result.stdout).toContain("Not signed in");
			expect(result.stdout).toContain("npx @tripwire-sh/cli@staging login");
			expect((await runCli(["logout", "--json"], env)).code).toBe(0);
			expect(requests).toEqual([]);
		}
		const login = await runCli(["login", "--no-browser", "--json"], env);
		expect(login.code).toBe(0);
		expect(staging.location).not.toBe(production.location);
		expect(statSync(staging.location).mode & 0o777).toBe(0o600);
		expect((await runCli(["whoami", "--json"], env)).code).toBe(0);
		const saved = await staging.read();
		if (!saved) throw new Error("Missing staging credential");
		await staging.write({
			...saved,
			expiresAt: 1,
			refreshToken: "staging-refresh",
		});
		expect((await runCli(["repos", "--json"], env)).code).toBe(0);
		expect(
			requests.some((request) =>
				request.includes("refresh_token=staging-refresh"),
			),
		).toBe(true);
		expect((await runCli(["logout", "--json"], env)).code).toBe(0);
		expect(
			requests.some(
				(request) =>
					request.includes("/oauth2/revoke") &&
					request.includes("token=staging-refresh"),
			),
		).toBe(true);
		expect(await staging.read()).toBeNull();
		expect(readFileSync(production.location, "utf8")).toBe(before);
		expect(requests.join("\n")).not.toContain(PRODUCTION.accessToken);
		expect(requests.join("\n")).not.toContain(PRODUCTION.refreshToken);
		requests.length = 0;
		expect(
			(
				await runCli(["whoami", "--json"], {
					...env,
					TRIPWIRE_STAGING_TOKEN: TEST_TOKEN,
				})
			).code,
		).toBe(0);
		expect(
			requests.some((request) => request.includes(`Bearer ${TEST_TOKEN}`)),
		).toBe(true);
	} finally {
		await proxy.stop(true);
		await upstream.stop();
	}
});

test("staging install coexists with production and installs staging instructions", async () => {
	sandbox.addBinary("cursor", "exit 0");
	const config = join(sandbox.home, ".cursor", "mcp.json");
	mkdirSync(join(config, ".."), { recursive: true });
	writeFileSync(
		config,
		JSON.stringify({ mcpServers: { tripwire: { url: PRODUCTION.mcpUrl } } }),
	);
	const skills = join(sandbox.home, ".agents", "skills");
	mkdirSync(join(skills, "tripwire-get-started"), { recursive: true });
	writeFileSync(
		join(skills, "tripwire-get-started", "SKILL.md"),
		"production skill",
	);
	const env = { ...sandbox.env, TRIPWIRE_ENV: "staging" };
	const result = await runCli(["install", "acme#abcde12345", "--json"], env);
	expect(result.code).toBe(0);
	expect(JSON.parse(result.stdout).prompt).toContain(
		"tripwire-staging-get-started",
	);
	expect(JSON.parse(readFileSync(config, "utf8"))).toEqual({
		mcpServers: {
			tripwire: { url: PRODUCTION.mcpUrl },
			"tripwire-staging": {
				url: "https://tripwire-mcp-preview-tripwire.unkey.app/mcp",
			},
		},
	});
	expect(
		readFileSync(join(skills, "tripwire-get-started", "SKILL.md"), "utf8"),
	).toBe("production skill");
	for (const name of ["get-started", "workflows"]) {
		const body = readFileSync(
			join(skills, `tripwire-staging-${name}`, "SKILL.md"),
			"utf8",
		);
		expect(body).toStartWith(`---\nname: tripwire-staging-${name}\n`);
		expect(body).toContain(
			"description: For explicit Tripwire staging requests only.",
		);
		expect(body).toContain("Use only the tripwire-staging MCP server");
		expect(body).toContain("@tripwire-sh/cli@staging");
		expect(body).not.toContain("https://app.tripwire.sh");
		expect(body).not.toMatch(/@tripwire-sh\/cli(?!@staging)/);
	}
	const again = await runCli(["install", "--json"], env);
	expect(again.code).toBe(0);
	expect(JSON.parse(again.stdout).agents[0].mcp.outcome).toBe("unchanged");
});

test.each([
	["staging", "production"],
	["production", "staging"],
])("Grok installs %s then %s without skipping either server", async (first, second) => {
	const order = [first, second];
	sandbox.addBinary(
		"grok",
		`printf "%s\\n" "grok $*" >> "$ARGV_LOG"
if [ "$1 $2" = "mcp list" ]; then
  if [ -f "$HOME/grok-servers" ]; then /bin/cat "$HOME/grok-servers"; fi
fi
if [ "$1 $2" = "mcp add" ]; then
  printf '%s\\n' "$5" >> "$HOME/grok-servers"
fi`,
	);
	for (const target of order) {
		const env = { ...sandbox.env, TRIPWIRE_ENV: target };
		const result = await runCli(["install", "--json"], env);
		expect(result.code).toBe(0);
		expect(JSON.parse(result.stdout).agents[0].mcp.outcome).toBe("added");
		const again = await runCli(["install", "--json"], env);
		expect(again.code).toBe(0);
		expect(JSON.parse(again.stdout).agents[0].mcp.outcome).toBe("unchanged");
	}
	expect(
		readFileSync(join(sandbox.home, "grok-servers"), "utf8")
			.trim()
			.split("\n")
			.sort(),
	).toEqual(["tripwire", "tripwire-staging"]);
	expect(
		sandbox.argv().filter((line) => line.startsWith("grok mcp add")),
	).toEqual(
		order.map((target) => {
			const name = target === "staging" ? "tripwire-staging" : "tripwire";
			const url =
				target === "staging"
					? "https://tripwire-mcp-preview-tripwire.unkey.app/mcp"
					: PRODUCTION.mcpUrl;
			return `grok mcp add --transport http ${name} ${url}`;
		}),
	);
	for (const name of ["tripwire", "tripwire-staging"]) {
		for (const skill of ["get-started", "workflows"]) {
			expect(
				readFileSync(
					join(
						sandbox.home,
						".agents",
						"skills",
						`${name}-${skill}`,
						"SKILL.md",
					),
					"utf8",
				),
			).toStartWith(`---\nname: ${name}-${skill}\n`);
		}
	}
});
