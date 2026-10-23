import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI_ENTRY = join(import.meta.dir, "..", "src", "index.ts");

export interface Sandbox {
	root: string;
	home: string;
	bin: string;
	argvLog: string;
	env: Record<string, string>;
	addBinary(name: string, body: string): void;
	argv(): string[];
	cleanup(): void;
}

const RECORD = 'printf "%s\\n" "$(/usr/bin/basename "$0") $*" >> "$ARGV_LOG"';

export const FAKE_CLAUDE = `${RECORD}
if [ "$1 $2" = "mcp add" ]; then
  printf '{"mcpServers":{"tripwire":{"type":"http","url":"%s"}}}' "$6" > "$HOME/.claude.json"
fi
if [ "$1 $2" = "mcp remove" ]; then
  printf '{}' > "$HOME/.claude.json"
fi
exit 0`;

export const FAKE_CODEX = `${RECORD}
if [ "$1 $2" = "mcp add" ]; then
  /bin/mkdir -p "$HOME/.codex"
  printf '[mcp_servers.tripwire]\\nurl = "%s"\\n' "$5" > "$HOME/.codex/config.toml"
fi
exit 0`;

export const FAKE_CLIPBOARD = `/bin/cat > "$HOME/clipboard.txt"
exit 0`;

export function makeSandbox(): Sandbox {
	const root = mkdtempSync(join(tmpdir(), "tripwire-cli-"));
	const home = join(root, "home");
	const bin = join(root, "bin");
	const apps = join(root, "Applications");
	mkdirSync(home, { recursive: true });
	mkdirSync(bin, { recursive: true });
	mkdirSync(apps, { recursive: true });
	const argvLog = join(root, "argv.log");
	writeFileSync(argvLog, "");
	const env = {
		HOME: home,
		PATH: bin,
		ARGV_LOG: argvLog,
		TRIPWIRE_APP_DIRS: apps,
		TRIPWIRE_CREDENTIAL_STORE: "file",
		NO_COLOR: "1",
	};
	return {
		root,
		home,
		bin,
		argvLog,
		env,
		addBinary(name, body) {
			const path = join(bin, name);
			writeFileSync(path, `#!/bin/sh\n${body}\n`);
			chmodSync(path, 0o755);
		},
		argv() {
			return readFileSync(argvLog, "utf8").split("\n").filter(Boolean);
		},
		cleanup() {
			rmSync(root, { recursive: true, force: true });
		},
	};
}

export async function runCli(
	args: string[],
	env: Record<string, string>,
): Promise<{ code: number; stdout: string; stderr: string }> {
	const child = Bun.spawn([process.execPath, CLI_ENTRY, ...args], {
		env,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { code, stdout, stderr };
}
