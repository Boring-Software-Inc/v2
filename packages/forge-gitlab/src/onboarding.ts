import { encodeProject, GitlabHttp } from "./client/http.ts";

/**
 * GitLab onboarding — the mirror of GitHub's App installation, but user-driven.
 * GitLab has no passive install: after OAuth, the maintainer picks projects and
 * Tripwire registers a webhook on each. These two calls are that flow's halves:
 * list the projects a maintainer can gate, then create the delivery hook.
 *
 * Both act with the maintainer's OAuth token, so they build a `GitlabHttp` whose
 * `tokenFor` always returns that one token (there is no repo scope yet — the
 * repo row is created FROM this step).
 */

/** GitLab access level 40 = Maintainer. Below it, a webhook cannot be created. */
const MAINTAINER_ACCESS_LEVEL = 40;

export interface GitlabOnboardingOptions {
	/** The maintainer's GitLab OAuth access token (`api` scope). */
	token: string;
	/** API base; defaults to gitlab.com. Self-managed GitLab sets its own. */
	apiBase?: string;
	fetchImpl?: typeof fetch;
}

/** A project the maintainer can gate, shaped for a `repos` upsert. */
export interface GitlabProject {
	/** The GitLab project id, as a string. */
	externalId: string;
	/** Namespace path (everything before the project segment). */
	owner: string;
	/** Project path (the last segment). */
	name: string;
	/** `namespace/project`. */
	fullName: string;
	private: boolean;
}

interface RawProject {
	id: number;
	path: string;
	path_with_namespace: string;
	visibility: string;
}

function httpFor(options: GitlabOnboardingOptions): GitlabHttp {
	return new GitlabHttp({
		tokenFor: () => Promise.resolve(options.token),
		apiBase: options.apiBase,
		fetchImpl: options.fetchImpl,
	});
}

/** Split `group/sub/project` into owner (`group/sub`) and keep the last segment. */
function ownerOf(pathWithNamespace: string): string {
	const parts = pathWithNamespace.split("/");
	parts.pop();
	return parts.join("/") || pathWithNamespace;
}

/**
 * The projects this maintainer can gate — membership with at least Maintainer
 * access, so hook creation will succeed. One page (100) is the MVP ceiling.
 */
export async function listMaintainedProjects(
	options: GitlabOnboardingOptions,
): Promise<GitlabProject[]> {
	const projects = (await httpFor(options).get(
		"",
		`/projects?membership=true&min_access_level=${MAINTAINER_ACCESS_LEVEL}&per_page=100`,
	)) as RawProject[];
	return projects.map((project) => ({
		externalId: String(project.id),
		owner: ownerOf(project.path_with_namespace),
		name: project.path,
		fullName: project.path_with_namespace,
		private: project.visibility !== "public",
	}));
}

export interface CreateProjectHookInput {
	/** The GitLab project id. */
	projectId: string;
	/** The public delivery URL (`…/webhooks/gitlab`). */
	url: string;
	/** Secret token; GitLab returns it as `X-Gitlab-Token` for verification. */
	secret: string;
}

/**
 * Register the delivery webhook on a project — the events Tripwire ingests, with
 * SSL verification on. Idempotency is the caller's job: GitLab happily creates
 * duplicate hooks, so the onboarding path checks for an existing tripwire hook
 * before calling this.
 */
export async function createProjectHook(
	options: GitlabOnboardingOptions,
	input: CreateProjectHookInput,
): Promise<{ externalId: string }> {
	const created = (await httpFor(options).post(
		"",
		`/projects/${encodeProject(input.projectId)}/hooks`,
		{
			url: input.url,
			token: input.secret,
			merge_requests_events: true,
			note_events: true,
			push_events: true,
			enable_ssl_verification: true,
		},
	)) as { id: number };
	return { externalId: String(created.id) };
}
