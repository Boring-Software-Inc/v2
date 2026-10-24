import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const libDir = import.meta.dir;

export interface ServerFn {
	name: string;
	/** Whether the builder chain attaches the access-guard middleware. */
	gated: boolean;
	/** Which org-role middleware (if any) the chain attaches. */
	orgRole: "admin" | "member" | null;
	/** Whether the chain attaches the platform-staff middleware. */
	staff: boolean;
	permission: string | "dynamic" | null;
	sameOrigin: boolean;
	notImpersonating: boolean;
	method: string | null;
	file: string;
}

const PERMISSION_CALL = /orgPermissionMiddleware\(\s*"([\w-]+:[\w-]+)"\s*\)/;
const METHOD = /createServerFn\(\s*\{\s*method:\s*"(\w+)"/;
export const ORG_SHELL = [
	"getOrgContext",
	"getOrgHomeState",
	"getOrgRepoContext",
	"leaveOrg",
	"rememberActiveOrg",
];

export function discoverServerFns(): ServerFn[] {
	const found: ServerFn[] = [];
	for (const file of readdirSync(libDir)) {
		if (!file.endsWith(".functions.ts")) {
			continue;
		}
		const src = readFileSync(join(libDir, file), "utf8");
		const re = /export const (\w+)\s*=\s*createServerFn\(/g;
		let m: RegExpExecArray | null = re.exec(src);
		while (m !== null) {
			const name = m[1] as string;
			// Gating lives in the builder chain between this declaration and its
			// `.handler(` — a gated fn carries `.middleware([accessGuardMiddleware])`
			// there. (The chain can't wrap `createServerFn` in a helper or the
			// compiler won't split it — gated-server-fn.ts explains why.)
			const handlerIdx = src.indexOf(".handler(", m.index);
			const chain =
				handlerIdx === -1 ? src.slice(m.index) : src.slice(m.index, handlerIdx);
			found.push({
				name,
				gated: chain.includes("accessGuardMiddleware"),
				orgRole: chain.includes("orgAdminMiddleware")
					? "admin"
					: chain.includes("orgMemberMiddleware")
						? "member"
						: null,
				staff: chain.includes("platformAdminMiddleware"),
				permission: chain.includes("orgPermissionMiddleware(")
					? (PERMISSION_CALL.exec(chain)?.[1] ?? "dynamic")
					: null,
				method: METHOD.exec(chain)?.[1] ?? null,
				sameOrigin: chain.includes("sameOriginMiddleware"),
				notImpersonating: chain.includes("notImpersonatingMiddleware"),
				file,
			});
			m = re.exec(src);
		}
	}
	return found;
}
