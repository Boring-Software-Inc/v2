import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";

export const PROJECT_LINK_PATH = join(".tripwire", "project.json");

export const projectLinkSchema = z.object({
	org: z.string().min(1).optional(),
	repo: z.string().min(1),
	workflows: z.record(z.string().min(1), z.string().min(1)).optional(),
});

export type ProjectLink = z.infer<typeof projectLinkSchema>;

export interface FoundLink {
	path: string;
	link: ProjectLink;
}

export class InvalidProjectLinkError extends Error {
	readonly path: string;

	constructor(path: string) {
		super(
			`${path} is not a valid Tripwire link. Run tripwire link <repo> to rewrite it.`,
		);
		this.path = path;
	}
}

function readLink(path: string): ProjectLink {
	const invalid = new InvalidProjectLinkError(path);
	let raw: z.infer<ReturnType<typeof z.json>>;
	try {
		raw = z.json().parse(JSON.parse(readFileSync(path, "utf8")));
	} catch {
		throw invalid;
	}
	const parsed = projectLinkSchema.safeParse(raw);
	if (!parsed.success) {
		throw invalid;
	}
	return parsed.data;
}

export function findProjectLink(
	start: string,
	stop?: string,
): FoundLink | null {
	const last = stop === undefined ? undefined : resolve(stop);
	let dir = resolve(start);
	while (true) {
		const path = join(dir, PROJECT_LINK_PATH);
		if (existsSync(path)) {
			return { path, link: readLink(path) };
		}
		const parent = dirname(dir);
		if (dir === last || parent === dir) {
			return null;
		}
		dir = parent;
	}
}

export function writeProjectLink(dir: string, link: ProjectLink): string {
	const path = join(resolve(dir), PROJECT_LINK_PATH);
	mkdirSync(dirname(path), { recursive: true });
	const body = projectLinkSchema.parse(link);
	writeFileSync(path, `${JSON.stringify(body, null, "\t")}\n`);
	return path;
}

export function removeProjectLink(path: string): void {
	rmSync(path, { force: true });
}

export function resolveRepo(
	explicit: string | undefined,
	found: FoundLink | null,
): string {
	const repo = explicit || found?.link.repo;
	if (!repo) {
		throw new Error(
			"No repo given. Pass one, or run tripwire link <repo> in this project.",
		);
	}
	return repo;
}

export function resolveOrg(
	flag: string | undefined,
	env: string | undefined,
	found: FoundLink | null,
): string | undefined {
	return flag || env || found?.link.org;
}

export function sameLink(a: ProjectLink, b: ProjectLink): boolean {
	return (
		JSON.stringify(projectLinkSchema.parse(a)) ===
		JSON.stringify(projectLinkSchema.parse(b))
	);
}

export function workflowMapping(
	keys: ReadonlyMap<string, string>,
): Record<string, string> {
	return Object.fromEntries(
		[...keys]
			.map(([id, key]): [string, string] => [key, id])
			.sort(([a], [b]) => a.localeCompare(b)),
	);
}

export function linkedWorkflowFile(
	file: string,
	fileIsDefault: boolean,
	cwd: string,
	found: FoundLink | null,
): string {
	if (!fileIsDefault || !found || existsSync(join(cwd, file))) {
		return file;
	}
	return join(dirname(dirname(found.path)), file);
}
